const bcrypt = require('bcrypt')
const config = require('./../config')
const db = require('knex')(config.database)
const randomstring = require('randomstring')
const utils = require('./utilsController')

const authController = {}

authController.verify = async (req, res, next) => {
  const username = req.body.username
  const password = req.body.password

  if (username === undefined) { return res.json({ success: false, description: 'No username provided.' }) }
  if (password === undefined) { return res.json({ success: false, description: 'No password provided.' }) }

  const user = await db.table('users').where('username', username).first()
  if (!user) { return res.json({ success: false, description: 'Username doesn\'t exist.' }) }
  if (user.enabled === false || user.enabled === 0) {
    return res.json({ success: false, description: 'This account has been disabled.' })
  }

  bcrypt.compare(password, user.password, (error, result) => {
    if (error) {
      console.error(error)
      return res.json({ success: false, description: 'There was an error.' })
    }
    if (result === false) { return res.json({ success: false, description: 'Wrong password.' }) }
    return res.json({ success: true, token: user.token })
  })
}

authController.register = async (req, res, next) => {
  if (config.enableUserAccounts === false) {
    return res.json({ success: false, description: 'Register is disabled at the moment.' })
  }

  const username = req.body.username
  const password = req.body.password

  if (username === undefined) { return res.json({ success: false, description: 'No username provided.' }) }
  if (password === undefined) { return res.json({ success: false, description: 'No password provided.' }) }

  if (username.length < 4 || username.length > 32) {
    return res.json({ success: false, description: 'Username must have 4-32 characters.' })
  }
  if (password.length < 6 || password.length > 64) {
    return res.json({ success: false, description: 'Password must have 6-64 characters.' })
  }

  const user = await db.table('users').where('username', username).first()
  if (user) { return res.json({ success: false, description: 'Username already exists.' }) }

  bcrypt.hash(password, 10, async (error, hash) => {
    if (error) {
      console.error(error)
      return res.json({ success: false, description: 'Error generating password hash (╯°□°）╯︵ ┻━┻.' })
    }
    const token = randomstring.generate(64)
    await db.table('users').insert({
      username,
      password: hash,
      token,
      enabled: 1
    })
    return res.json({ success: true, token })
  })
}

authController.changePassword = async (req, res, next) => {
  const user = await utils.authorize(req, res)
  if (!user) { return }

  const password = req.body.password
  if (password === undefined) { return res.json({ success: false, description: 'No password provided.' }) }

  if (password.length < 6 || password.length > 64) {
    return res.json({ success: false, description: 'Password must have 6-64 characters.' })
  }

  bcrypt.hash(password, 10, async (error, hash) => {
    if (error) {
      console.error(error)
      return res.json({ success: false, description: 'Error generating password hash (╯°□°）╯︵ ┻━┻.' })
    }

    await db.table('users')
      .where('id', user.id)
      .update('password', hash)

    return res.json({ success: true })
  })
}

authController.getFileLengthConfig = async (req, res, next) => {
  const user = await utils.authorize(req, res)
  if (!user) { return }
  return res.json({ success: true, fileLength: user.fileLength, config: config.uploads.fileLength })
}

authController.changeFileLength = async (req, res, next) => {
  if (config.uploads.fileLength.userChangeable === false) {
    return res.json({ success: false, description: 'Changing file name length is disabled at the moment.' })
  }

  const user = await utils.authorize(req, res)
  if (!user) { return }

  const fileLength = parseInt(req.body.fileLength)
  if (fileLength === undefined) { return res.json({ success: false, description: 'No file name length provided.' }) }
  if (isNaN(fileLength)) { return res.json({ success: false, description: 'File name length is not a valid number.' }) }

  if (fileLength < config.uploads.fileLength.min || fileLength > config.uploads.fileLength.max) {
    return res.json({ success: false, description: `File name length must be ${config.uploads.fileLength.min} to ${config.uploads.fileLength.max} characters.` })
  }

  if (fileLength === user.fileLength) {
    return res.json({ success: true })
  }

  await db.table('users')
    .where('id', user.id)
    .update('fileLength', fileLength)

  return res.json({ success: true })
}

module.exports = authController
