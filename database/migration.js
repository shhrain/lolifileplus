const config = require('./../config')
const db = require('knex')(config.database)

const map = {
  albums: {
    editedAt: 'integer',
    zipGeneratedAt: 'integer',
    download: 'integer',
    public: 'integer'
  },
  users: {
    enabled: 'integer',
    fileLength: 'integer'
  }
}

const migration = {}
migration.start = async () => {
  const tables = Object.keys(map)
  await Promise.all(tables.map(table => {
    const columns = Object.keys(map[table])
    return Promise.all(columns.map(async column => {
      if (await db.schema.hasColumn(table, column)) {
        return console.log(`Column "${column}" already exists in table "${table}".`)
      }
      const columnType = map[table][column]
      return db.schema.table(table, t => { t[columnType](column) })
        .then(() => console.log(`Added column "${column}" to table "${table}".`))
        .catch(console.error)
    }))
  }))

  console.log('Migration finished! Now start lolisafe normally')
  process.exit(0)
}

migration.start()
