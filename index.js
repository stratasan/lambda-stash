var _ = require('lodash');

exports.handler = function(config, event, context, callback) {
  var taskNames = [];
  var eventType = '';

  if (event.hasOwnProperty('Records') && event.Records.length &&
      event.Records[0].eventSource === 'aws:s3') {
    config.S3 = {
      srcBucket: event.Records[0].s3.bucket.name,
      srcKey: event.Records[0].s3.object.key
    };
    eventType = 'S3';
    taskNames.push('getS3Object');
    console.log('Handling event for s3://' + config.S3.srcBucket + '/' +
      config.S3.srcKey);
  } else if (event.hasOwnProperty('awslogs') &&
      event.awslogs.hasOwnProperty('data')) {
    config.data = event.awslogs.data;
    eventType = 'CloudWatch';
    taskNames.push('decodeBase64');
    taskNames.push('decompressGzip');
    taskNames.push('parseJson');
    console.log('Handling event for CloudWatch logs');
  }

  var currentMapping;
  if (config.mappings) {
    _.some(config.mappings, function(item) {
      if (item.type === eventType ||
          (config.S3 && item.bucket === config.S3.srcBucket)) {
        currentMapping = item;
        console.log('Selected mapping for S3 event:', item);
        if (item.hasOwnProperty('processors')) {
          taskNames = taskNames.concat(item.processors);
        }
        config = _.merge({}, config, item);
        return true;
      }
    });
    delete config.mappings;
  }

  if (!currentMapping) {
    console.log('Event did not match any mappings.');
    return callback(null, 'Event did not match any mappings.');
  }

  
  var _config = JSON.parse(JSON.stringify(config)) // Deep clone object to prevent modifying the real config.httpAuth key
  if (_config.elasticsearch && _config.elasticsearch.httpAuth) {
    _config.elasticsearch.httpAuth = "*****"
  }
  console.log('Running ' + taskNames.length + ' handlers with _config:', _config);
  var tasks = [];
  var processor;
  _.some(taskNames, function(taskName) {
    if (_.isFunction(taskName)) {
      tasks.push(taskName);
      return false;
    }

    try {
      processor = require('./handlers/' + taskName);
    } catch (err) {
      context.fail(err);
      return true;
    }
    if (processor.hasOwnProperty('process')) {
      tasks.push(processor.process);
    }
  });

  console.log('Starting to run processor tasks...');

  Promise.series(tasks, config)
    .then(function(/* config */) {
      console.log('Successfully shipped data!');
      callback(null, 'Successfully shipped data!');
    })
    .catch(function(err) {
      console.log('Error occurred while preparing to ship data:', err);
      context.fail('Error occurred while preparing to ship data');
    });
};

Promise.series = function(promises, initValue) {
  return promises.reduce(function(chain, promise) {
    return chain.then(promise);
  }, Promise.resolve(initValue));
};
