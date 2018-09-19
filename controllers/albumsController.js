const config = require('./../config')
const db = require('knex')(config.database)
const EventEmitter = require('events')
const fs = require('fs')
const path = require('path')
const randomstring = require('randomstring')
const utils = require('./utilsController')
const Zip = require('jszip')

const albumsController = {}

const maxTries = config.uploads.maxTries || 1
const homeDomain = config.homeDomain || config.domain
const uploadsDir = path.join(__dirname, '..', config.uploads.folder)
const zipsDir = path.join(uploadsDir, 'zips')
const zipMaxTotalSize = config.cloudflare.zipMaxTotalSize
const zipMaxTotalSizeBytes = parseInt(config.cloudflare.zipMaxTotalSize) * 1000000

albumsController.zipEmitters = new Map()

class ZipEmitter extends EventEmitter {
  constructor (identifier) {
    super()
    this.identifier = identifier
    this.once('done', () => albumsController.zipEmitters.delete(this.identifier))
  }
}

albumsController.list = async (req, res, next) => {
  const user = await utils.authorize(req, res)
  if (!user) { return }

  let fields = ['id', 'name']
  if (req.params.sidebar === undefined) {
    fields = fields.concat(fields, ['timestamp', 'identifier', 'editedAt', 'download', 'public'])
  }

  const albums = await db.table('albums')
    .select(fields)
    .where({
      enabled: 1,
      userid: user.id
    })

  if (req.params.sidebar !== undefined) {
    return res.json({ success: true, albums })
  }

  const ids = []
  for (const album of albums) {
    album.date = utils.getPrettyDate(new Date(album.timestamp * 1000))
    album.download = album.download !== 0
    album.public = album.public !== 0

    ids.push(album.id)
  }

  const files = await db.table('files')
    .whereIn('albumid', ids)
    .select('albumid')
  const albumsCount = {}

  for (const id of ids) { albumsCount[id] = 0 }
  for (const file of files) { albumsCount[file.albumid] += 1 }
  for (const album of albums) { album.files = albumsCount[album.id] }

  return res.json({ success: true, albums, homeDomain })
}

albumsController.create = async (req, res, next) => {
  const user = await utils.authorize(req, res)
  if (!user) { return }

  const name = req.body.name
  if (name === undefined || name === '') {
    return res.json({ success: false, description: 'No album name specified.' })
  }

  const album = await db.table('albums')
    .where({
      name,
      enabled: 1,
      userid: user.id
    })
    .first()

  if (album) {
    return res.json({ success: false, description: 'There\'s already an album with that name.' })
  }

  const identifier = await albumsController.getUniqueRandomName()
    .catch(error => {
      res.json({ success: false, description: error.toString() })
    })
  if (!identifier) { return }

  const ids = await db.table('albums').insert({
    name,
    enabled: 1,
    userid: user.id,
    identifier,
    timestamp: Math.floor(Date.now() / 1000),
    editedAt: 0,
    zipGeneratedAt: 0,
    download: (req.body.download === false || req.body.download === 0) ? 0 : 1,
    public: (req.body.public === false || req.body.public === 0) ? 0 : 1
  })

  return res.json({ success: true, id: ids[0] })
}

albumsController.getUniqueRandomName = () => {
  return new Promise((resolve, reject) => {
    const select = i => {
      const identifier = randomstring.generate(config.uploads.albumIdentifierLength)
      db.table('albums')
        .where('identifier', identifier)
        .then(rows => {
          if (!rows || !rows.length) { return resolve(identifier) }
          console.log(`An album with identifier ${identifier} already exists (${++i}/${maxTries}).`)
          if (i < maxTries) { return select(i) }
          // eslint-disable-next-line prefer-promise-reject-errors
          return reject('Sorry, we could not allocate a unique random identifier. Try again?')
        })
    }
    // Get us a unique random identifier
    select(0)
  })
}

albumsController.delete = async (req, res, next) => {
  const user = await utils.authorize(req, res)
  if (!user) { return }

  const id = req.body.id
  const purge = req.body.purge
  if (id === undefined || id === '') {
    return res.json({ success: false, description: 'No album specified.' })
  }

  let failed = []
  if (purge) {
    const files = await db.table('files')
      .where({
        albumid: id,
        userid: user.id
      })

    if (files.length) {
      const ids = files.map(file => file.id)
      failed = await utils.bulkDeleteFiles('id', ids, user)

      if (failed.length === ids.length) {
        return res.json({ success: false, description: 'Could not delete any of the files associated with the album.' })
      }
    }
  }

  await db.table('albums')
    .where({
      id,
      userid: user.id
    })
    .update('enabled', 0)

  const identifier = await db.table('albums')
    .select('identifier')
    .where({
      id,
      userid: user.id
    })
    .first()
    .then(row => row.identifier)

  // Unlink zip archive of the album if it exists
  const zipPath = path.join(zipsDir, `${identifier}.zip`)
  fs.unlink(zipPath, error => {
    if (error && error.code !== 'ENOENT') {
      console.error(error)
      return res.json({ success: false, description: error.toString(), failed })
    }
    res.json({ success: true, failed })
  })
}

albumsController.edit = async (req, res, next) => {
  const user = await utils.authorize(req, res)
  if (!user) { return }

  const id = parseInt(req.body.id)
  if (isNaN(id)) {
    return res.json({ success: false, description: 'No album specified.' })
  }

  const name = req.body.name
  if (name === undefined || name === '') {
    return res.json({ success: false, description: 'No name specified.' })
  }

  const album = await db.table('albums')
    .where({
      name,
      userid: user.id,
      enabled: 1
    })
    .first()

  if (album && (album.id !== id)) {
    return res.json({ success: false, description: 'Name already in use.' })
  } else if (req._old && (album.id === id)) {
    return res.json({ success: false, description: 'You did not specify a new name.' })
  }

  await db.table('albums')
    .where({
      id,
      userid: user.id
    })
    .update({
      name,
      download: Boolean(req.body.download),
      public: Boolean(req.body.public)
    })

  if (req.body.requestLink) {
    const oldIdentifier = await db.table('albums')
      .select('identifier')
      .where({
        id,
        userid: user.id
      })
      .first()
      .then(row => row.identifier)

    const identifier = await albumsController.getUniqueRandomName()
      .catch(error => {
        res.json({ success: false, description: error.toString() })
      })
    if (!identifier) { return }

    await db.table('albums')
      .where({
        id,
        userid: user.id
      })
      .update('identifier', identifier)

    // Rename zip archive of the album if it exists
    const zipPath = path.join(zipsDir, `${oldIdentifier}.zip`)
    return fs.access(zipPath, error => {
      if (error) { return res.json({ success: true, identifier }) }
      fs.rename(zipPath, path.join(zipsDir, `${identifier}.zip`), error => {
        if (!error) { return res.json({ success: true, identifier }) }
        console.error(error)
        res.json({ success: false, description: error.toString() })
      })
    })
  }

  return res.json({ success: true, name })
}

albumsController.rename = async (req, res, next) => {
  req._old = true
  req.body = { name: req.body.name }
  return albumsController.edit(req, res, next)
}

albumsController.get = async (req, res, next) => {
  // TODO:
  const identifier = req.params.identifier
  if (identifier === undefined) {
    return res.status(401).json({ success: false, description: 'No identifier provided.' })
  }

  const album = await db.table('albums')
    .where({
      identifier,
      enabled: 1
    })
    .first()

  if (!album) {
    return res.json({ success: false, description: 'Album not found.' })
  } else if (album.public === 0) {
    return res.status(401).json({
      success: false,
      description: 'This album is not available for public.'
    })
  }

  const title = album.name
  const files = await db.table('files')
    .select('name')
    .where('albumid', album.id)
    .orderBy('id', 'DESC')

  for (const file of files) {
    file.file = `${config.domain}/${file.name}`

    const extname = utils.extname(file.name)
    if (utils.mayGenerateThumb(extname)) {
      file.thumb = `${config.domain}/thumbs/${file.name.slice(0, -extname.length)}.png`
    }
  }

  return res.json({
    success: true,
    title,
    count: files.length,
    files
  })
}

albumsController.generateZip = async (req, res, next) => {
  const versionString = parseInt(req.query.v)
  const download = (filePath, fileName) => {
    const headers = { 'Access-Control-Allow-Origin': '*' }
    if (versionString > 0) {
      // Cache-Control header is useful when using CDN (max-age: 30 days)
      headers['Cache-Control'] = 'public, max-age=2592000, must-revalidate, proxy-revalidate, immutable, stale-while-revalidate=86400, stale-if-error=604800'
    }
    return res.download(filePath, fileName, { headers })
  }

  const identifier = req.params.identifier
  if (identifier === undefined) {
    return res.status(401).json({
      success: false,
      description: 'No identifier provided.'
    })
  }

  if (!config.uploads.generateZips) {
    return res.status(401).json({ success: false, description: 'Zip generation disabled.' })
  }

  const album = await db.table('albums')
    .where({
      identifier,
      enabled: 1
    })
    .first()

  if (!album) {
    return res.json({ success: false, description: 'Album not found.' })
  } else if (album.download === 0) {
    return res.json({ success: false, description: 'Download for this album is disabled.' })
  }

  if ((!versionString || versionString <= 0) && album.editedAt) {
    return res.redirect(`${album.identifier}?v=${album.editedAt}`)
  }

  if (album.zipGeneratedAt > album.editedAt) {
    const filePath = path.join(zipsDir, `${identifier}.zip`)
    const exists = await new Promise(resolve => fs.access(filePath, error => resolve(!error)))
    if (exists) {
      const fileName = `${album.name}.zip`
      return download(filePath, fileName)
    }
  }

  if (albumsController.zipEmitters.has(identifier)) {
    console.log(`Waiting previous zip task for album: ${identifier}.`)
    return albumsController.zipEmitters.get(identifier).once('done', (filePath, fileName, json) => {
      if (filePath && fileName) {
        download(filePath, fileName)
      } else if (json) {
        res.json(json)
      }
    })
  }

  albumsController.zipEmitters.set(identifier, new ZipEmitter(identifier))

  console.log(`Starting zip task for album: ${identifier}.`)
  const files = await db.table('files')
    .select('name', 'size')
    .where('albumid', album.id)
  if (files.length === 0) {
    console.log(`Finished zip task for album: ${identifier} (no files).`)
    const json = { success: false, description: 'There are no files in the album.' }
    albumsController.zipEmitters.get(identifier).emit('done', null, null, json)
    return res.json(json)
  }

  if (zipMaxTotalSize) {
    const totalSizeBytes = files.reduce((accumulator, file) => accumulator + parseInt(file.size), 0)
    if (totalSizeBytes > zipMaxTotalSizeBytes) {
      console.log(`Finished zip task for album: ${identifier} (size exceeds).`)
      const json = {
        success: false,
        description: `Total size of all files in the album exceeds the configured limit (${zipMaxTotalSize}).`
      }
      albumsController.zipEmitters.get(identifier).emit('done', null, null, json)
      return res.json(json)
    }
  }

  const zipPath = path.join(zipsDir, `${album.identifier}.zip`)
  const archive = new Zip()

  let iteration = 0
  for (const file of files) {
    fs.readFile(path.join(uploadsDir, file.name), (error, data) => {
      if (error) {
        console.error(error)
      } else {
        archive.file(file.name, data)
      }

      iteration++
      if (iteration === files.length) {
        archive
          .generateNodeStream({
            type: 'nodebuffer',
            streamFiles: true,
            compression: 'DEFLATE',
            compressionOptions: { level: 1 }
          })
          .pipe(fs.createWriteStream(zipPath))
          .on('finish', async () => {
            console.log(`Finished zip task for album: ${identifier} (success).`)
            await db.table('albums')
              .where('id', album.id)
              .update('zipGeneratedAt', Math.floor(Date.now() / 1000))

            const filePath = path.join(zipsDir, `${identifier}.zip`)
            const fileName = `${album.name}.zip`

            albumsController.zipEmitters.get(identifier).emit('done', filePath, fileName)
            return download(filePath, fileName)
          })
      }
    })
  }
}

albumsController.addFiles = async (req, res, next) => {
  const user = await utils.authorize(req, res)
  if (!user) { return }

  const ids = req.body.ids
  if (!ids || !ids.length) {
    return res.json({ success: false, description: 'No files specified.' })
  }

  let albumid = req.body.albumid
  if (typeof albumid !== 'number') { albumid = parseInt(albumid) }
  if (isNaN(albumid) || (albumid < 0)) { albumid = null }

  const albumids = []

  if (albumid !== null) {
    const album = await db.table('albums')
      .where('id', albumid)
      .where(function () {
        if (user.username !== 'root') {
          this.where('userid', user.id)
        }
      })
      .first()

    if (!album) {
      return res.json({ success: false, description: 'Album doesn\'t exist or it doesn\'t belong to the user.' })
    }

    albumids.push(albumid)
  }

  const files = await db.table('files')
    .whereIn('id', ids)
    .where(function () {
      if (user.username !== 'root') {
        this.where('userid', user.id)
      }
    })

  const failed = ids.filter(id => !files.find(file => file.id === id))

  const updateDb = await db.table('files')
    .whereIn('id', files.map(file => file.id))
    .update('albumid', albumid)
    .catch(console.error)

  if (!updateDb) {
    return res.json({
      success: false,
      description: `Could not ${albumid === null ? 'add' : 'remove'} any files ${albumid === null ? 'to' : 'from'} the album.`
    })
  }

  files.forEach(file => {
    if (file.albumid && !albumids.includes(file.albumid)) {
      albumids.push(file.albumid)
    }
  })

  await db.table('albums')
    .whereIn('id', albumids)
    .update('editedAt', Math.floor(Date.now() / 1000))
    .catch(console.error)

  return res.json({ success: true, failed })
}

module.exports = albumsController
