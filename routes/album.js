const config = require('./../config')
const routes = require('express').Router()
const db = require('knex')(config.database)
const path = require('path')
const utils = require('./../controllers/utilsController')

const homeDomain = config.homeDomain || config.domain

routes.get('/a/:identifier', async (req, res, next) => {
  const identifier = req.params.identifier
  if (identifier === undefined) {
    return res.status(401).json({
      success: false,
      description: 'No identifier provided.'
    })
  }

  const album = await db.table('albums')
    .where({
      identifier,
      enabled: 1
    })
    .first()

  if (!album) {
    return res.status(404).sendFile('404.html', { root: './pages/error/' })
  } else if (album.public === 0) {
    return res.status(401).json({
      success: false,
      description: 'This album is not available for public.'
    })
  }

  const files = await db.table('files')
    .select('name', 'size')
    .where('albumid', album.id)
    .orderBy('id', 'DESC')

  let thumb = ''
  const basedomain = config.domain

  for (const file of files) {
    file.file = `${basedomain}/${file.name}`
    file.size = utils.getPrettyBytes(parseInt(file.size))

    file.extname = path.extname(file.name).toLowerCase()
    if (utils.mayGenerateThumb(file.extname)) {
      file.thumb = `${basedomain}/thumbs/${file.name.slice(0, -file.extname.length)}.png`

      /*
        If thumbnail for album is still not set, do it.
        A potential improvement would be to let the user upload a specific image as an album cover
        since embedding the first image could potentially result in nsfw content when pasting links.
      */
      if (thumb === '') { thumb = file.thumb }
    }
  }

  return res.render('album', {
    title: album.name,
    count: files.length,
    thumb,
    files,
    identifier,
    generateZips: config.uploads.generateZips,
    downloadLink: album.download === 0 ? null : `../api/album/zip/${album.identifier}?v=${album.editedAt}`,
    editedAt: album.editedAt,
    url: `${homeDomain}/a/${album.identifier}`
  })
})

module.exports = routes
