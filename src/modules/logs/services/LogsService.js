"use strict";class LogsService{resolveDestination(entry,config){return config[entry.channelKey]||null;}createEntry(input){return Object.freeze({...input});}}module.exports={LogsService};
