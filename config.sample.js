module.exports = {
  /*
    If set to true the user will need to specify the auto-generated token
    on each API call, meaning random strangers won't be able to use the service
    unless they have the token lolisafe provides you with.
    If it's set to false, then upload will be public for anyone to use.
  */
  private: true,

  /*
    If true, users will be able to create accounts and access their uploaded files.
  */
  enableUserAccounts: true,

  /*
    Here you can decide if you want lolisafe to serve the files or if you prefer doing so via nginx.
    The main difference between the two is the ease of use and the chance of analytics in the future.
    If you set it to `true`, the uploaded files will be located after the host like:
      https://lolisafe.moe/yourFile.jpg

    If you set it to `false`, you need to set nginx to directly serve whatever folder it is you are serving your
    downloads in. This also gives you the ability to serve them, for example, like this:
      https://files.lolisafe.moe/yourFile.jpg

    Both cases require you to type the domain where the files will be served on the `domain` key below.
    Which one you use is ultimately up to you.
  */
  serveFilesWithNode: false,
  domain: 'https://www.cc0c.cc',

  /*
    If you are serving your files with a different domain than your lolisafe homepage,
    then fill this option with your lolisafe homepage, otherwise leave it null (or other falsy value).
    This will be used when listing album links in the dashboard.
  */
  homeDomain: null,

  /*
    Port on which to run the server.
  */
  port: 23333,

  /*
    Pages to process for the frontend.
  */
  pages: ['home', 'auth', 'dashboard', 'faq'],

  /*
    If set to true, all extensions in "extensionsFilter" array will be blacklisted,
    otherwise only files with those extensions that can be uploaded.
  */
  filterBlacklist: true,

  extensionsFilter: [
    '.jar',
    '.exe',
    '.msi',
    '.com',
    '.bat',
    '.cmd',
    '.nt',
    '.scr',
    '.ps1',
    '.psm1',
    '.sh',
    '.bash',
    '.bsh',
    '.csh',
    '.bash_profile',
    '.bashrc',
    '.profile'
  ],

  /*
    Uploads config.
  */
  uploads: {
    /*
      Folder where images should be stored.
    */
    folder: 'uploads',

    /*
      Max file size allowed. Needs to be in MB.
      Note: When maxSize is greater than 1 MiB, you must set the client_max_body_size to the same as maxSize.
    */
    maxSize: '512MB',

    /*
      Max file size allowed for upload by URLs. Needs to be in MB.
      NOTE: Set to falsy value (false, null, etc.) to disable upload by URLs.
    */
    urlMaxSize: '32MB',

    /*
      Scan files using ClamAV through clamd.
    */
    scan: {
      enabled: false,
      ip: '127.0.0.1',
      port: 3310
    },

    /*
      Use DuckDuckGo's proxy when fetching any URL uploads.
      This may be considered a hack and not supported by DuckDuckGo, so USE AT YOUR OWN RISK.
      This have only been tested with pictures, GIFs, WEBMs and MP4s.
    */
    urlDuckDuckGoProxy: false,

    /*
      Chunk size for chunk uploads. Needs to be in MB.
      If this is enabled, every files uploaded from the homepage uploader will forcibly be chunked
      by the size specified in "chunkSize". People will still be able to upload bigger files with
      the API as long as they don't surpass the limit specified in the "maxSize" option above.
      Total size of the whole chunks will also later be checked against the "maxSize" option.
      NOTE: Set to falsy value (false, null, etc.) to disable chunked uploads.
    */
    chunkSize: '10MB',

    /*
      The length of the randomly generated name for uploaded files.
      If "userChangeable" is set to true, registered users will be able to change
      their preferred file name length from the dashboard. The allowed range will
      be set by "min" and "max". Otherwise it will use "default".
      Technically it's possible to have "default" outside of the "min" and "max" range,
      but please not. Otherwise, once a user has changed to a value within the range,
      the user will no longer be able to use the default value.
    */
    fileLength: {
      min: 4,
      max: 32,
      default: 32,
      userChangeable: false
    },

    /*
      The length of the randomly generated identifier for albums.
    */
    albumIdentifierLength: 8,

    /*
      This option will limit how many times it will try to
      generate a new random name when a collision occurrs.
      The shorter the length is, the higher the chance for a collision to occur.
    */
    maxTries: 1,

    /*
      Thumbnails are only for the admin panel and they require you to install
      a separate binary called graphicsmagick (http://www.graphicsmagick.org) for images
      and ffmpeg (https://ffmpeg.org/) for video files.
    */
    generateThumbs: {
      image: true,
      video: false
    },

    /*
      Allows users to download a ZIP file of all files in an album.
      The file is generated when the user clicks the download button in the view
      and is re-used if the album has not changed between download requests.
    */
    generateZips: true
  },

  /*
    Cloudflare support.
  */
  cloudflare: {
    /*
      No-JS uploader page will not chunk the uploads, so it's recommended to change this
      into the maximum upload size you have in Cloudflare.
      This limit will only be applied to the subtitle in the page.
      NOTE: Set to falsy value (false, null, etc.) to inherit "maxSize" option.
    */
    noJsMaxSize: '100MB',

    /*
      If you have a Page Rule in Cloudflare to cache everything in the album zippping
      API route (HOME_DOMAIN/api/album/zip/*), with this option you can limit the
      maximum total size of files in an album that can be zipped.
      Cloudflare will not cache files bigger than 512MB.
      NOTE: Set to falsy value (false, null, etc.) to disable max total size.
    */
    zipMaxTotalSize: '512MB',

    /*
      If you want to make it automatically calls Cloudflare's API to purge cache on file delete,
      fill your api key, email and your site's zone id below, then set "purgeCache" to true.
      This will only purge cache of the deleted file and its associated thumb.
    */
    apiKey: '',
    email: '',
    zoneId: '',
    purgeCache: false
  },

  /*
    Folder where to store logs.
  */
  logsFolder: 'logs',

  /*
    The following values shouldn't be touched, unless you know what you are doing.
  */
  database: {
    client: 'sqlite3',
    connection: { filename: './database/db' },
    useNullAsDefault: true
  }
}
