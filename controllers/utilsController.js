const config = require('./../config')
const db = require('knex')(config.database)
const ffmpeg = require('fluent-ffmpeg')
const fs = require('fs')
const gm = require('gm')
const path = require('path')
const snekfetch = require('snekfetch')

const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

const utilsController = {}
const uploadsDir = path.join(__dirname, '..', config.uploads.folder)
const thumbsDir = path.join(uploadsDir, 'thumbs')
const thumbUnavailable = path.join(__dirname, '../public/images/unavailable.png')
const cloudflareAuth = config.cloudflare.apiKey && config.cloudflare.email && config.cloudflare.zoneId

utilsController.imageExtensions = ['.webp', '.jpg', '.jpeg', '.bmp', '.gif', '.png']
utilsController.videoExtensions = ['.webm', '.mp4', '.wmv', '.avi', '.mov', '.mkv']

utilsController.mayGenerateThumb = extname => {
  return (config.uploads.generateThumbs.image && utilsController.imageExtensions.includes(extname)) ||
    (config.uploads.generateThumbs.video && utilsController.videoExtensions.includes(extname))
}

// expand if necessary (must be lower case); for now only preserves some known tarballs
utilsController.preserves = ['.tar.gz', '.tar.z', '.tar.bz2', '.tar.lzma', '.tar.lzo', '.tar.xz']

utilsController.extname = filename => {
  let lower = filename.toLowerCase() // due to this, the returned extname will always be lower case
  let multi = ''
  let extname = ''

  // check for multi-archive extensions (.001, .002, and so on)
  if (/\.\d{3}$/.test(lower)) {
    multi = lower.slice(lower.lastIndexOf('.') - lower.length)
    lower = lower.slice(0, lower.lastIndexOf('.'))
  }

  // check against extensions that must be preserved
  for (let i = 0; i < utilsController.preserves.length; i++) {
    if (lower.endsWith(utilsController.preserves[i])) {
      extname = utilsController.preserves[i]
      break
    }
  }

  if (!extname) {
    extname = lower.slice(lower.lastIndexOf('.') - lower.length) // path.extname(lower)
  }

  return extname + multi
}

utilsController.getPrettyDate = date => {
  return date.getFullYear() + '-' +
    (date.getMonth() + 1) + '-' +
    date.getDate() + ' ' +
    (date.getHours() < 10 ? '0' : '') +
    date.getHours() + ':' +
    (date.getMinutes() < 10 ? '0' : '') +
    date.getMinutes() + ':' +
    (date.getSeconds() < 10 ? '0' : '') +
    date.getSeconds()
}

utilsController.getPrettyBytes = num => {
  // MIT License
  // Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
  if (!Number.isFinite(num)) { return num }

  const neg = num < 0
  if (neg) { num = -num }
  if (num < 1) { return (neg ? '-' : '') + num + ' B' }

  const exponent = Math.min(Math.floor(Math.log10(num) / 3), units.length - 1)
  const numStr = Number((num / Math.pow(1000, exponent)).toPrecision(3))
  const unit = units[exponent]

  return (neg ? '-' : '') + numStr + ' ' + unit
}

utilsController.authorize = async (req, res) => {
  const token = req.headers.token
  if (token === undefined) {
    res.status(401).json({ success: false, description: 'No token provided.' })
    return
  }

  const user = await db.table('users').where('token', token).first()
  if (user) { return user }

  res.status(401).json({ success: false, description: 'Invalid token.' })
}

utilsController.generateThumbs = (name, force) => {
  return new Promise(resolve => {
    const extname = utilsController.extname(name)
    const thumbname = path.join(thumbsDir, name.slice(0, -extname.length) + '.png')
    fs.lstat(thumbname, async (error, stats) => {
      if (error && error.code !== 'ENOENT') {
        console.error(error)
        return resolve(false)
      }

      if (!error && stats.isSymbolicLink()) {
        // Unlink symlink
        const unlink = await new Promise((resolve, reject) => {
          fs.unlink(thumbname, error => {
            if (error) { return reject(error) }
            return resolve(true)
          })
        }).catch(console.error)
        if (!unlink) { return resolve(false) }
      }

      // Only make thumbnail if it does not exist (ENOENT)
      if (!error && !stats.isSymbolicLink() && !force) { return resolve(true) }

      // If image extension
      if (utilsController.imageExtensions.includes(extname)) {
        const size = { width: 200, height: 200 }
        return gm(path.join(__dirname, '..', config.uploads.folder, name))
          .resize(size.width, size.height + '>')
          .gravity('Center')
          .extent(size.width, size.height)
          .background('transparent')
          .write(thumbname, error => {
            if (!error) { return resolve(true) }
            console.error(`${name}: ${error.message.trim()}`)
            fs.symlink(thumbUnavailable, thumbname, error => {
              if (error) { console.error(error) }
              resolve(!error)
            })
          })
      }

      // Otherwise video extension
      ffmpeg(path.join(__dirname, '..', config.uploads.folder, name))
        .thumbnail({
          timestamps: ['1%'],
          filename: '%b.png',
          folder: path.join(__dirname, '..', config.uploads.folder, 'thumbs'),
          size: '200x?'
        })
        .on('error', error => {
          console.log(`${name}: ${error.message}`)
          fs.symlink(thumbUnavailable, thumbname, error => {
            if (error) { console.error(error) }
            resolve(!error)
          })
        })
        .on('end', () => {
          resolve(true)
        })
    })
  })
}

utilsController.deleteFile = file => {
  return new Promise((resolve, reject) => {
    const extname = utilsController.extname(file)
    return fs.unlink(path.join(uploadsDir, file), error => {
      if (error && error.code !== 'ENOENT') { return reject(error) }

      if (utilsController.imageExtensions.includes(extname) || utilsController.videoExtensions.includes(extname)) {
        const thumb = file.substr(0, file.lastIndexOf('.')) + '.png'
        return fs.unlink(path.join(thumbsDir, thumb), error => {
          if (error && error.code !== 'ENOENT') { return reject(error) }
          resolve(true)
        })
      }
      resolve(true)
    })
  })
}

/**
 * Delete files by matching whether the specified field contains any value
 * in the array of values. This will return an array of values that could
 * not be deleted. At the moment it's hard-coded to only accept either
 * "id" or "name" field.
 *
 * @param  {string} field
 * @param  {any} values
 * @param  {user} user
 * @return {any[]} failed
 */
utilsController.bulkDeleteFiles = async (field, values, user) => {
  if (!user || !['id', 'name'].includes(field)) { return }

  const files = await db.table('files')
    .whereIn(field, values)
    .where(function () {
      if (user.username !== 'root') {
        this.where('userid', user.id)
      }
    })

  const deleted = []
  const failed = values.filter(value => !files.find(file => file[field] === value))

  // Delete all files physically
  await Promise.all(files.map(file => {
    return new Promise(async resolve => {
      await utilsController.deleteFile(file.name)
        .then(() => deleted.push(file.id))
        .catch(error => {
          failed.push(file[field])
          console.error(error)
        })
      resolve()
    })
  }))

  if (!deleted.length) { return failed }

  // Delete all files from database
  const deleteDb = await db.table('files')
    .whereIn('id', deleted)
    .del()
    .catch(console.error)
  if (!deleteDb) { return failed }

  const filtered = files.filter(file => deleted.includes(file.id))

  // Update albums if necessary
  if (deleteDb) {
    const albumids = []
    filtered.forEach(file => {
      if (file.albumid && !albumids.includes(file.albumid)) {
        albumids.push(file.albumid)
      }
    })
    await db.table('albums')
      .whereIn('id', albumids)
      .update('editedAt', Math.floor(Date.now() / 1000))
      .catch(console.error)
  }

  if (config.cloudflare.purgeCache) {
    // purgeCloudflareCache() is an async function, but let us not wait for it
    const names = filtered.map(file => file.name)
    utilsController.purgeCloudflareCache(names)
  }

  return failed
}

utilsController.purgeCloudflareCache = async names => {
  if (!cloudflareAuth) { return }

  const thumbs = []
  names = names.map(name => {
    const url = `${config.domain}/${name}`
    const extname = utilsController.extname(name)
    if (utilsController.mayGenerateThumb(extname)) {
      thumbs.push(`${config.domain}/thumbs/${name.slice(0, -extname.length)}.png`)
    }
    return url
  })

  const purge = await snekfetch
    .post(`https://api.cloudflare.com/client/v4/zones/${config.cloudflare.zoneId}/purge_cache`)
    .set({
      'X-Auth-Email': config.cloudflare.email,
      'X-Auth-Key': config.cloudflare.apiKey
    })
    .send({ files: names.concat(thumbs) })
    .catch(error => error)

  if (!purge.body) {
    console.error(`CF: ${purge.toString()}`)
  } else if (!purge.body.success && purge.body.errors) {
    purge.body.errors.forEach(error => console.error(`CF: ${error.code}: ${error.message}`))
  }
}

module.exports = utilsController
