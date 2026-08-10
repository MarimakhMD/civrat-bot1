"use strict";class LogsEventMapper{map(input){return Object.freeze({...input,details:Object.freeze({...input.details})});}}module.exports={LogsEventMapper};
