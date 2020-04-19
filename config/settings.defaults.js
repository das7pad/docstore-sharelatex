/*
 * decaffeinate suggestions:
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const http = require('http')
http.globalAgent.maxSockets = 300

const Settings = {
  internal: {
    docstore: {
      port: 3016,
      host: process.env.LISTEN_ADDRESS || 'localhost'
    }
  },

  mongo: {},

  docstore: {
    healthCheck: {
      project_id: process.env.HEALTH_CHECK_PROJECT_ID
    },
    s3: {
      key: process.env.AWS_ACCESS_KEY_ID,
      secret: process.env.AWS_SECRET_ACCESS_KEY,
      bucket: process.env.AWS_BUCKET,
      endpoint: process.env.AWS_S3_ENDPOINT,
      forcePathStyle: process.env.AWS_S3_PATH_STYLE === 'true'
    }
  },

  max_doc_length: parseInt(process.env.MAX_DOC_LENGTH) || 2 * 1024 * 1024 // 2mb
}

if (process.env.MONGO_CONNECTION_STRING != null) {
  Settings.mongo.url = process.env.MONGO_CONNECTION_STRING
} else if (process.env.MONGO_HOST != null) {
  Settings.mongo.url = `mongodb://${process.env.MONGO_HOST}/sharelatex`
} else {
  Settings.mongo.url = 'mongodb://127.0.0.1/sharelatex'
}

module.exports = Settings
