(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (global){
"use strict";

/*jshint node: true */

var PouchDB = global.PouchDB;

if (PouchDB) {
    PouchDB = PouchDB.defaults({});

    PouchDB.allDbs = function () {
        var prefix = typeof PouchDB.prefix === "undefined" ? "_pouch_" : PouchDB.prefix;
        return getIDBDatabaseNames().then(function (databasesMap) {
            let names = databasesMap.map((databaseEntry) => {
                return databaseEntry.name;
            });

            return names.filter(function (name) {
                return name.indexOf(prefix) === 0;
            }).map(function (name) {
                return name.substr(prefix.length);
            }).filter(function (name) {
                return (
                    ["_checkModernIdb", "pouch__all_dbs__"].indexOf(name) === -1 &&
                    name.indexOf("-mrview-") === -1 &&
                    name.indexOf("-session-") === -1
                );
            });
        });
    };
}

var req2resp = require("./req2resp.js")(PouchDB);
var PostMessageRPC = require("./postmessagerpc.js");

var rpc = new PostMessageRPC(global.postMessage, "page");
global.addEventListener("message", rpc.onMessage);
rpc.serve("req2resp", req2resp);

var getIDBDatabaseNames;
// supported on every browser except firefox at the time of writing
// https://developer.mozilla.org/en-US/docs/Web/API/IDBFactory/databases
if (global.indexedDB.databases) {
    getIDBDatabaseNames = function () {
        return global.indexedDB.databases();
    };
} else {
    // I don't know how the fallback worked before but it probably no longer work on those browsers
    //In Firefox, ask the add-on to provide the idb db names
    getIDBDatabaseNames = rpc.call.bind(rpc, "main", "getIDBDatabaseNames");
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./postmessagerpc.js":2,"./req2resp.js":3}],2:[function(require,module,exports){
/*
Example usage:

var rpc = new PostMessageRPC(window.postMessage, "thispage");
window.addEventListener("message", rpc.onMessage);

rpc.serve("getThingy", function () {
  return Promise.resolve("Hello World!");
});

rpc.call("getThingy").then(function (resp) {
  console.log(resp); // "Hello World!"
});

A window.postMessage() on the client side needs to be connected to the
server's onmessage event - and the other way around for this to work.
Also, the thisName in the constructor needs to match with the one passed
to PostMessageRPC.call.

When the connection isn't sound, the promise PostMessageRPC.call returns
is never resolved.

*/

"use strict";

var Promise = Promise || require("lie");

function PostMessageRPC(postMessage, thisName) {
  this._postMessage = function (msg) {
    postMessage(msg, "*");
  };
  this._thisName = thisName;
  this.onMessage = this._onMessage.bind(this);

  this._idCount = 0;
  this._served = {};
  this._responseHandlers = {};
}
module.exports = PostMessageRPC;

PostMessageRPC.prototype._onMessage = function (event) {
  // || event for not-so-strict implementations (i.e. in browser addons)
  var info = event.data || event;

  if (info.destination === this._thisName) {
    this._handleServing(info);
    this._handleResponses(info);
  }
};

PostMessageRPC.prototype._handleServing = function (info) {
  var self = this;
  if (info.type !== "call") {
    return;
  }

  var msg = {};
  Promise.resolve().then(function () {
    return self._served[info.name].apply(null, info.arguments);
  }).then(function (resp) {
    msg.response = resp;
  }).catch(function (err) {
    msg.error = err;
  }).then(function () {
    msg.id = info.id;
    msg.type = "response";
    msg.destination = info.returnto;

    self._postMessage(msg);
  });
};

PostMessageRPC.prototype._handleResponses = function (info) {
  if (info.type === "response" && this._responseHandlers[info.id]) {
    this._responseHandlers[info.id](info);
  }
};

PostMessageRPC.prototype.serve = function (name, func) {
  this._served[name] = func;
};

PostMessageRPC.prototype.call = function (destination, name) {
  var self = this;
  var args = Array.prototype.slice.call(arguments, 2);
  var currentId = self._idCount++;

  return new Promise(function (resolve, reject) {
    self._responseHandlers[currentId] = function (data) {
      delete self._responseHandlers[currentId];

      if (data.error) {
        reject(data.error);
      } else {
        resolve(data.response);
      }
    };

    self._postMessage({
      id: currentId,
      name: name,
      arguments: args,
      type: "call",
      destination: destination,
      returnto: self._thisName
    });
  });
};

},{"lie":9}],3:[function(require,module,exports){
"use strict";

var route = require("pouchdb-route");
var Promise = Promise || require("lie");
var uuid = require("random-uuid-v4");

module.exports = function (PouchDB) {
  return function req2resp(req) {
    if (!PouchDB) {
      return Promise.reject("no_pouchdb_found");
    }
    return Promise.resolve()
      .then(function () {
        if (!req.path.length) {
          return {
            version: "0.1.0",
          };
        } else if (req.path[0] === "_session") {
          return {
            ok: true,
            userCtx: {
              name: null,
              roles: ["_admin"]
            }
          };
        } else if (req.path[0] === "_uuids") {
          var uuids = [];
          for (var i = 0; i < (req.query.count || 1); i += 1) {
            uuids.push(uuid());
          }
          return {
            uuids: uuids
          };
        } else if (req.path[0] === "_active_tasks") {
          return [];
        } else {
          return route(PouchDB, req, {});
        }
      })
      .then(function (resp) {
        return {
          status: 200,
          body: JSON.stringify(resp)
        };
      })
      .catch(function (err) {
        return {
          status: err.status || 500,
          body: JSON.stringify(err)
        };
      });
  };
};

},{"lie":9,"pouchdb-route":20,"random-uuid-v4":24}],4:[function(require,module,exports){
var hasOwn = Object.prototype.hasOwnProperty;
var toString = Object.prototype.toString;
var undefined;

var isPlainObject = function isPlainObject(obj) {
	"use strict";
	if (!obj || toString.call(obj) !== '[object Object]' || obj.nodeType || obj.setInterval) {
		return false;
	}

	var has_own_constructor = hasOwn.call(obj, 'constructor');
	var has_is_property_of_method = obj.constructor && obj.constructor.prototype && hasOwn.call(obj.constructor.prototype, 'isPrototypeOf');
	// Not own constructor property must be Object
	if (obj.constructor && !has_own_constructor && !has_is_property_of_method) {
		return false;
	}

	// Own properties are enumerated firstly, so to speed up,
	// if last one is own, then all properties are own.
	var key;
	for (key in obj) {}

	return key === undefined || hasOwn.call(obj, key);
};

module.exports = function extend() {
	"use strict";
	var options, name, src, copy, copyIsArray, clone,
		target = arguments[0],
		i = 1,
		length = arguments.length,
		deep = false;

	// Handle a deep copy situation
	if (typeof target === "boolean") {
		deep = target;
		target = arguments[1] || {};
		// skip the boolean and the target
		i = 2;
	} else if (typeof target !== "object" && typeof target !== "function" || target == undefined) {
			target = {};
	}

	for (; i < length; ++i) {
		// Only deal with non-null/undefined values
		if ((options = arguments[i]) != null) {
			// Extend the base object
			for (name in options) {
				src = target[name];
				copy = options[name];

				// Prevent never-ending loop
				if (target === copy) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if (deep && copy && (isPlainObject(copy) || (copyIsArray = Array.isArray(copy)))) {
					if (copyIsArray) {
						copyIsArray = false;
						clone = src && Array.isArray(src) ? src : [];
					} else {
						clone = src && isPlainObject(src) ? src : {};
					}

					// Never move original objects, clone them
					target[name] = extend(deep, clone, copy);

				// Don't bring in undefined values
				} else if (copy !== undefined) {
					target[name] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};


},{}],5:[function(require,module,exports){
(function (global){
'use strict';
var Mutation = global.MutationObserver || global.WebKitMutationObserver;

var scheduleDrain;

{
  if (Mutation) {
    var called = 0;
    var observer = new Mutation(nextTick);
    var element = global.document.createTextNode('');
    observer.observe(element, {
      characterData: true
    });
    scheduleDrain = function () {
      element.data = (called = ++called % 2);
    };
  } else if (!global.setImmediate && typeof global.MessageChannel !== 'undefined') {
    var channel = new global.MessageChannel();
    channel.port1.onmessage = nextTick;
    scheduleDrain = function () {
      channel.port2.postMessage(0);
    };
  } else if ('document' in global && 'onreadystatechange' in global.document.createElement('script')) {
    scheduleDrain = function () {

      // Create a <script> element; its readystatechange event will be fired asynchronously once it is inserted
      // into the document. Do so, thus queuing up the task. Remember to clean up once it's been called.
      var scriptEl = global.document.createElement('script');
      scriptEl.onreadystatechange = function () {
        nextTick();

        scriptEl.onreadystatechange = null;
        scriptEl.parentNode.removeChild(scriptEl);
        scriptEl = null;
      };
      global.document.documentElement.appendChild(scriptEl);
    };
  } else {
    scheduleDrain = function () {
      setTimeout(nextTick, 0);
    };
  }
}

var draining;
var queue = [];
//named nextTick for less confusing stack traces
function nextTick() {
  draining = true;
  var i, oldQueue;
  var len = queue.length;
  while (len) {
    oldQueue = queue;
    queue = [];
    i = -1;
    while (++i < len) {
      oldQueue[i]();
    }
    len = queue.length;
  }
  draining = false;
}

module.exports = immediate;
function immediate(task) {
  if (queue.push(task) === 1 && !draining) {
    scheduleDrain();
  }
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],6:[function(require,module,exports){
'use strict';

module.exports = INTERNAL;

function INTERNAL() {}
},{}],7:[function(require,module,exports){
'use strict';
var Promise = require('./promise');
var reject = require('./reject');
var resolve = require('./resolve');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = all;
function all(iterable) {
  if (Object.prototype.toString.call(iterable) !== '[object Array]') {
    return reject(new TypeError('must be an array'));
  }

  var len = iterable.length;
  var called = false;
  if (!len) {
    return resolve([]);
  }

  var values = new Array(len);
  var resolved = 0;
  var i = -1;
  var promise = new Promise(INTERNAL);
  
  while (++i < len) {
    allResolver(iterable[i], i);
  }
  return promise;
  function allResolver(value, i) {
    resolve(value).then(resolveFromAll, function (error) {
      if (!called) {
        called = true;
        handlers.reject(promise, error);
      }
    });
    function resolveFromAll(outValue) {
      values[i] = outValue;
      if (++resolved === len & !called) {
        called = true;
        handlers.resolve(promise, values);
      }
    }
  }
}
},{"./INTERNAL":6,"./handlers":8,"./promise":10,"./reject":13,"./resolve":14}],8:[function(require,module,exports){
'use strict';
var tryCatch = require('./tryCatch');
var resolveThenable = require('./resolveThenable');
var states = require('./states');

exports.resolve = function (self, value) {
  var result = tryCatch(getThen, value);
  if (result.status === 'error') {
    return exports.reject(self, result.value);
  }
  var thenable = result.value;

  if (thenable) {
    resolveThenable.safely(self, thenable);
  } else {
    self.state = states.FULFILLED;
    self.outcome = value;
    var i = -1;
    var len = self.queue.length;
    while (++i < len) {
      self.queue[i].callFulfilled(value);
    }
  }
  return self;
};
exports.reject = function (self, error) {
  self.state = states.REJECTED;
  self.outcome = error;
  var i = -1;
  var len = self.queue.length;
  while (++i < len) {
    self.queue[i].callRejected(error);
  }
  return self;
};

function getThen(obj) {
  // Make sure we only access the accessor once as required by the spec
  var then = obj && obj.then;
  if (obj && typeof obj === 'object' && typeof then === 'function') {
    return function appyThen() {
      then.apply(obj, arguments);
    };
  }
}

},{"./resolveThenable":15,"./states":16,"./tryCatch":17}],9:[function(require,module,exports){
module.exports = exports = require('./promise');

exports.resolve = require('./resolve');
exports.reject = require('./reject');
exports.all = require('./all');
exports.race = require('./race');

},{"./all":7,"./promise":10,"./race":12,"./reject":13,"./resolve":14}],10:[function(require,module,exports){
'use strict';

var unwrap = require('./unwrap');
var INTERNAL = require('./INTERNAL');
var resolveThenable = require('./resolveThenable');
var states = require('./states');
var QueueItem = require('./queueItem');

module.exports = Promise;
function Promise(resolver) {
  if (!(this instanceof Promise)) {
    return new Promise(resolver);
  }
  if (typeof resolver !== 'function') {
    throw new TypeError('resolver must be a function');
  }
  this.state = states.PENDING;
  this.queue = [];
  this.outcome = void 0;
  if (resolver !== INTERNAL) {
    resolveThenable.safely(this, resolver);
  }
}

Promise.prototype['catch'] = function (onRejected) {
  return this.then(null, onRejected);
};
Promise.prototype.then = function (onFulfilled, onRejected) {
  if (typeof onFulfilled !== 'function' && this.state === states.FULFILLED ||
    typeof onRejected !== 'function' && this.state === states.REJECTED) {
    return this;
  }
  var promise = new Promise(INTERNAL);
  if (this.state !== states.PENDING) {
    var resolver = this.state === states.FULFILLED ? onFulfilled : onRejected;
    unwrap(promise, resolver, this.outcome);
  } else {
    this.queue.push(new QueueItem(promise, onFulfilled, onRejected));
  }

  return promise;
};

},{"./INTERNAL":6,"./queueItem":11,"./resolveThenable":15,"./states":16,"./unwrap":18}],11:[function(require,module,exports){
'use strict';
var handlers = require('./handlers');
var unwrap = require('./unwrap');

module.exports = QueueItem;
function QueueItem(promise, onFulfilled, onRejected) {
  this.promise = promise;
  if (typeof onFulfilled === 'function') {
    this.onFulfilled = onFulfilled;
    this.callFulfilled = this.otherCallFulfilled;
  }
  if (typeof onRejected === 'function') {
    this.onRejected = onRejected;
    this.callRejected = this.otherCallRejected;
  }
}
QueueItem.prototype.callFulfilled = function (value) {
  handlers.resolve(this.promise, value);
};
QueueItem.prototype.otherCallFulfilled = function (value) {
  unwrap(this.promise, this.onFulfilled, value);
};
QueueItem.prototype.callRejected = function (value) {
  handlers.reject(this.promise, value);
};
QueueItem.prototype.otherCallRejected = function (value) {
  unwrap(this.promise, this.onRejected, value);
};

},{"./handlers":8,"./unwrap":18}],12:[function(require,module,exports){
'use strict';
var Promise = require('./promise');
var reject = require('./reject');
var resolve = require('./resolve');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = race;
function race(iterable) {
  if (Object.prototype.toString.call(iterable) !== '[object Array]') {
    return reject(new TypeError('must be an array'));
  }

  var len = iterable.length;
  var called = false;
  if (!len) {
    return resolve([]);
  }

  var i = -1;
  var promise = new Promise(INTERNAL);

  while (++i < len) {
    resolver(iterable[i]);
  }
  return promise;
  function resolver(value) {
    resolve(value).then(function (response) {
      if (!called) {
        called = true;
        handlers.resolve(promise, response);
      }
    }, function (error) {
      if (!called) {
        called = true;
        handlers.reject(promise, error);
      }
    });
  }
}

},{"./INTERNAL":6,"./handlers":8,"./promise":10,"./reject":13,"./resolve":14}],13:[function(require,module,exports){
'use strict';

var Promise = require('./promise');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = reject;

function reject(reason) {
	var promise = new Promise(INTERNAL);
	return handlers.reject(promise, reason);
}
},{"./INTERNAL":6,"./handlers":8,"./promise":10}],14:[function(require,module,exports){
'use strict';

var Promise = require('./promise');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = resolve;

var FALSE = handlers.resolve(new Promise(INTERNAL), false);
var NULL = handlers.resolve(new Promise(INTERNAL), null);
var UNDEFINED = handlers.resolve(new Promise(INTERNAL), void 0);
var ZERO = handlers.resolve(new Promise(INTERNAL), 0);
var EMPTYSTRING = handlers.resolve(new Promise(INTERNAL), '');

function resolve(value) {
  if (value) {
    if (value instanceof Promise) {
      return value;
    }
    return handlers.resolve(new Promise(INTERNAL), value);
  }
  var valueType = typeof value;
  switch (valueType) {
    case 'boolean':
      return FALSE;
    case 'undefined':
      return UNDEFINED;
    case 'object':
      return NULL;
    case 'number':
      return ZERO;
    case 'string':
      return EMPTYSTRING;
  }
}
},{"./INTERNAL":6,"./handlers":8,"./promise":10}],15:[function(require,module,exports){
'use strict';
var handlers = require('./handlers');
var tryCatch = require('./tryCatch');
function safelyResolveThenable(self, thenable) {
  // Either fulfill, reject or reject with error
  var called = false;
  function onError(value) {
    if (called) {
      return;
    }
    called = true;
    handlers.reject(self, value);
  }

  function onSuccess(value) {
    if (called) {
      return;
    }
    called = true;
    handlers.resolve(self, value);
  }

  function tryToUnwrap() {
    thenable(onSuccess, onError);
  }
  
  var result = tryCatch(tryToUnwrap);
  if (result.status === 'error') {
    onError(result.value);
  }
}
exports.safely = safelyResolveThenable;
},{"./handlers":8,"./tryCatch":17}],16:[function(require,module,exports){
// Lazy man's symbols for states

exports.REJECTED = ['REJECTED'];
exports.FULFILLED = ['FULFILLED'];
exports.PENDING = ['PENDING'];

},{}],17:[function(require,module,exports){
'use strict';

module.exports = tryCatch;

function tryCatch(func, value) {
  var out = {};
  try {
    out.value = func(value);
    out.status = 'success';
  } catch (e) {
    out.status = 'error';
    out.value = e;
  }
  return out;
}
},{}],18:[function(require,module,exports){
'use strict';

var immediate = require('immediate');
var handlers = require('./handlers');
module.exports = unwrap;

function unwrap(promise, func, value) {
  immediate(function () {
    var returnValue;
    try {
      returnValue = func(value);
    } catch (e) {
      return handlers.reject(promise, e);
    }
    if (returnValue === promise) {
      handlers.reject(promise, new TypeError('Cannot resolve promise with itself'));
    } else {
      handlers.resolve(promise, returnValue);
    }
  });
}
},{"./handlers":8,"immediate":5}],19:[function(require,module,exports){
/*
  Copyright 2014, Marten de Vries

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

"use strict";

function PouchPluginError(opts) {
  this.status = opts.status;
  this.name = opts.name;
  this.message = opts.message;
  this.error = true;
  this.stack = (new Error()).stack;
}

PouchPluginError.prototype.toString = function () {
  return JSON.stringify({
    status: this.status,
    name: this.name,
    message: this.message
  });
};

module.exports = PouchPluginError;

},{}],20:[function(require,module,exports){
/*
  Copyright 2014, Marten de Vries

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

"use strict";

var PouchPluginError = require("pouchdb-plugin-error");
var extend = require("extend");
var querystring = require("querystring");

module.exports = function route(PouchDB, req, options) {
  //Mapping urls to PouchDB/plug-in functions. Based on:
  //http://docs.couchdb.org/en/latest/http-api.html
  if (req.path[0] === "..") {
    throw404(); //coverage: ignore
  }
  if (req.query) {
    for (var key in req.query) {
      if (req.query.hasOwnProperty(key)) {
        try {
          req.query[key] = JSON.parse(req.query[key]);
        } catch (e) {
          //don't replace the original value
        }
      }
    }
  }
  var rootFunc = {
    "_all_dbs": (PouchDB.allDbs || throw404).bind(PouchDB),
    "_replicate": callWithBody.bind(null, PouchDB, req, function (body) {
      return this.replicate(body.source, body.target, body);
    }),
    "_session": function () {
      if (!PouchDB.seamlessSession) {
        throw404();
      }
      return ({
        GET: PouchDB.seamlessSession.bind(PouchDB),
        POST: function () {
          var data = parseBody(req);
          return PouchDB.seamlessLogIn(data.name, data.password);
        },
        DELETE: PouchDB.seamlessLogOut.bind(PouchDB)
      }[req.method] || throw405.bind(null, req))();
    }
  }[req.path[0]];
  if (rootFunc) {
    return rootFunc();
  }
  var db = new PouchDB(decodeURIComponent(req.path[0]));
  var localCallWithBody = callWithBody.bind(null, db, req);
  if (req.path.length === 1) {
    var post = options.withValidation ? db.validatingPost : db.post;
    var defaultDBFunc = db.info.bind(db);
    return ({
      DELETE: db.destroy.bind(db),
      POST: localCallWithBody.bind(null, post, crudOpts(req, options))
    }[req.method] || defaultDBFunc)();
  }

  var localRouteCRUD = routeCRUD.bind(null, db, req, options);
  var defaultFunc = localRouteCRUD.bind(null, req.path[1], req.path.slice(2));
  var bulkDocs = options.withValidation ? db.validatingBulkDocs : db.bulkDocs;
  return ({
    "_all_docs": db.allDocs.bind(db, req.query),
    "_bulk_docs": localCallWithBody.bind(null, bulkDocs, crudOpts(req, options)),
    "_changes": db.changes.bind(db, req.query),
    "_compact": db.compact.bind(db),
    "_design": function () {
      var url = req.path[2] + "/" + req.path.slice(4).join("/");
      var subDefaultFunc = localRouteCRUD.bind(null, "_design/" + req.path[2], req.path.slice(3));
      return ({
        "_list": (db.list || throw404).bind(db, url, req),
        "_rewrite": function () {
          var newReq = extend({}, req);
          delete newReq.path;
          return (db.rewrite || throw404).bind(db, url, newReq)();
        },
        "_search": (db.search || throw404).bind(db, url, req.query),
        "_show": (db.show || throw404).bind(db, url, req),
        "_spatial": (db.spatial || throw404).bind(db, url, req.query),
        "_update": (db.update || throw404).bind(db, url, req),
        "_view": db.query.bind(db, url, req.query)
      }[req.path[3]] || subDefaultFunc)();
    },
    "_local": localRouteCRUD.bind(null, "_local/" + req.path[2], req.path.slice(3)),
    "_revs_diff": localCallWithBody.bind(null, db.revsDiff),
    "_security": function () {
      return ({
        GET: localCallWithBody.bind(null, db.getSecurity),
        PUT: localCallWithBody.bind(null, db.putSecurity)
      }[req.method] || throw405.bind(null, req))();
    },
    "_temp_view": localCallWithBody.bind(null, db.query, req.query),
    "_view_cleanup": db.viewCleanup.bind(db, req.query)
  }[req.path[1]] || defaultFunc)();
};

function crudOpts(req, options) {
  return extend({}, req.query, options);
}

function callWithBody(thisObj, req, func) {
  var args = Array.prototype.slice.call(arguments, 3);
  args.unshift(parseBody(req));
  return func.apply(thisObj, args);
}

function parseBody(req) {
  try {
    return JSON.parse(req.body);
  } catch (err) {
    return querystring.parse(req.body);
  }
}

function routeCRUD(db, req, options, docId, remainingPath) {
  var opts = crudOpts(req, options);
  docId = decodeURIComponent(docId);
  function callAttachment(isPut) {
    var funcs;
    var args = [docId, remainingPath[0], req.query.rev];
    if (isPut) {
      args.push(req.body);
      args.push(req.headers["Content-Type"]);

      funcs = {
        true: db.validatingPutAttachment,
        false: db.putAttachment
      };
    } else {
      funcs = {
        true: db.validatingRemoveAttachment,
        false: db.removeAttachment
      };
    }
    if (options.withValidation) {
      args.push(opts);
    }
    return funcs[options.withValidation].apply(db, args);
  }

  //document level
  if (remainingPath.length === 0) {
    var localCallWithBody = callWithBody.bind(null, db, req);
    var put = options.withValidation ? db.validatingPut : db.put;
    var remove = options.withValidation ? db.validatingRemove : db.remove;
    return ({
      GET: function () {
        return db.get(docId, opts);
      },
      PUT: localCallWithBody.bind(null, put, opts),
      DELETE: remove.bind(db, docId, opts.rev)
    }[req.method] || throw405.bind(null, req))();
  }
  //attachment level
  return ({
    GET: function () {
      return db.getAttachment(docId, remainingPath.join("/"), opts);
    },
    PUT: callAttachment.bind(null, true),
    DELETE: callAttachment.bind(null, false),

  }[req.method] || throw405.bind(null, req))();
}

function throw404() {
  throw new PouchPluginError({status: 404, name: "not_found", message: "missing"});
}

function throw405(req) {
  throw new PouchPluginError({
    status: 405,
    name: "method_not_allowed",
    message: "method '" + req.method + "' not allowed."
  });
}

},{"extend":4,"pouchdb-plugin-error":19,"querystring":23}],21:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

// If obj.hasOwnProperty has been overridden, then calling
// obj.hasOwnProperty(prop) will break.
// See: https://github.com/joyent/node/issues/1707
function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

module.exports = function(qs, sep, eq, options) {
  sep = sep || '&';
  eq = eq || '=';
  var obj = {};

  if (typeof qs !== 'string' || qs.length === 0) {
    return obj;
  }

  var regexp = /\+/g;
  qs = qs.split(sep);

  var maxKeys = 1000;
  if (options && typeof options.maxKeys === 'number') {
    maxKeys = options.maxKeys;
  }

  var len = qs.length;
  // maxKeys <= 0 means that we should not limit keys count
  if (maxKeys > 0 && len > maxKeys) {
    len = maxKeys;
  }

  for (var i = 0; i < len; ++i) {
    var x = qs[i].replace(regexp, '%20'),
        idx = x.indexOf(eq),
        kstr, vstr, k, v;

    if (idx >= 0) {
      kstr = x.substr(0, idx);
      vstr = x.substr(idx + 1);
    } else {
      kstr = x;
      vstr = '';
    }

    k = decodeURIComponent(kstr);
    v = decodeURIComponent(vstr);

    if (!hasOwnProperty(obj, k)) {
      obj[k] = v;
    } else if (isArray(obj[k])) {
      obj[k].push(v);
    } else {
      obj[k] = [obj[k], v];
    }
  }

  return obj;
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

},{}],22:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var stringifyPrimitive = function(v) {
  switch (typeof v) {
    case 'string':
      return v;

    case 'boolean':
      return v ? 'true' : 'false';

    case 'number':
      return isFinite(v) ? v : '';

    default:
      return '';
  }
};

module.exports = function(obj, sep, eq, name) {
  sep = sep || '&';
  eq = eq || '=';
  if (obj === null) {
    obj = undefined;
  }

  if (typeof obj === 'object') {
    return map(objectKeys(obj), function(k) {
      var ks = encodeURIComponent(stringifyPrimitive(k)) + eq;
      if (isArray(obj[k])) {
        return map(obj[k], function(v) {
          return ks + encodeURIComponent(stringifyPrimitive(v));
        }).join(sep);
      } else {
        return ks + encodeURIComponent(stringifyPrimitive(obj[k]));
      }
    }).join(sep);

  }

  if (!name) return '';
  return encodeURIComponent(stringifyPrimitive(name)) + eq +
         encodeURIComponent(stringifyPrimitive(obj));
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

function map (xs, f) {
  if (xs.map) return xs.map(f);
  var res = [];
  for (var i = 0; i < xs.length; i++) {
    res.push(f(xs[i], i));
  }
  return res;
}

var objectKeys = Object.keys || function (obj) {
  var res = [];
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) res.push(key);
  }
  return res;
};

},{}],23:[function(require,module,exports){
'use strict';

exports.decode = exports.parse = require('./decode');
exports.encode = exports.stringify = require('./encode');

},{"./decode":21,"./encode":22}],24:[function(require,module,exports){
/**
 *
 * This function was taken from a stackoverflow answer:
 *
 * http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
 *
 * Many thanks to:
 *
 * Briguy37 (http://stackoverflow.com/users/508537/briguy37)
 * broofa (http://stackoverflow.com/users/109538/broofa)
 *
 */

module.exports = function() {
    var d = new Date().getTime();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = (d + Math.random()*16)%16 | 0;
        d = Math.floor(d/16);
        return (c=='x' ? r : (r&0x7|0x8)).toString(16);
    });
};

},{}]},{},[1]);
