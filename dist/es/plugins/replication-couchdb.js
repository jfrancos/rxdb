import _asyncToGenerator from "@babel/runtime/helpers/asyncToGenerator";
import _regeneratorRuntime from "@babel/runtime/regenerator";

/**
 * this plugin adds the RxCollection.sync()-function to rxdb
 * you can use it to sync collections with remote or local couchdb-instances
 */
import PouchReplicationPlugin from 'pouchdb-replication';
import { BehaviorSubject, Subject, fromEvent, firstValueFrom } from 'rxjs';
import { skipUntil, filter, first, mergeMap } from 'rxjs/operators';
import { promiseWait, flatClone } from '../util';
import { newRxError } from '../rx-error';
import { pouchReplicationFunction, isInstanceOf as isInstanceOfPouchDB, addPouchPlugin } from '../plugins/pouchdb';
import { isRxCollection } from '../rx-collection';
import { _handleFromStorageInstance } from '../rx-collection-helper'; // add pouchdb-replication-plugin

addPouchPlugin(PouchReplicationPlugin);
/**
 * Contains all pouchdb instances that
 * are used inside of RxDB by collections or databases.
 * Used to ensure the remote of a replication cannot be an internal pouchdb.
 */

var INTERNAL_POUCHDBS = new WeakSet();
export var RxCouchDBReplicationStateBase = /*#__PURE__*/function () {
  function RxCouchDBReplicationStateBase(collection, syncOptions) {
    var _this = this;

    this._subs = [];
    this._subjects = {
      change: new Subject(),
      docs: new Subject(),
      denied: new Subject(),
      active: new BehaviorSubject(false),
      complete: new BehaviorSubject(false),
      alive: new BehaviorSubject(false),
      error: new Subject()
    };
    this.canceled = false;
    this.collection = collection;
    this.syncOptions = syncOptions;
    // create getters
    Object.keys(this._subjects).forEach(function (key) {
      Object.defineProperty(_this, key + '$', {
        get: function get() {
          return this._subjects[key].asObservable();
        }
      });
    });
  }

  var _proto = RxCouchDBReplicationStateBase.prototype;

  _proto.awaitInitialReplication = function awaitInitialReplication() {
    if (this.syncOptions.options && this.syncOptions.options.live) {
      throw newRxError('RC4', {
        database: this.collection.database.name,
        collection: this.collection.name
      });
    }

    if (this.collection.database.multiInstance && this.syncOptions.waitForLeadership) {
      throw newRxError('RC5', {
        database: this.collection.database.name,
        collection: this.collection.name
      });
    }

    var that = this;
    return firstValueFrom(that.complete$.pipe(filter(function (x) {
      return !!x;
    })));
  }
  /**
   * Returns false when the replication has already been canceled
   */
  ;

  _proto.cancel = function cancel() {
    if (this.canceled) {
      return Promise.resolve(false);
    }

    this.canceled = true;

    this.collection._repStates["delete"](this);

    if (this._pouchEventEmitterObject) {
      this._pouchEventEmitterObject.cancel();
    }

    this._subs.forEach(function (sub) {
      return sub.unsubscribe();
    });

    return Promise.resolve(true);
  };

  return RxCouchDBReplicationStateBase;
}();
export function setPouchEventEmitter(rxRepState, evEmitter) {
  if (rxRepState._pouchEventEmitterObject) {
    throw newRxError('RC1');
  }

  rxRepState._pouchEventEmitterObject = evEmitter; // change

  rxRepState._subs.push(fromEvent(evEmitter, 'change').subscribe(function (ev) {
    rxRepState._subjects.change.next(ev);
  })); // denied


  rxRepState._subs.push(fromEvent(evEmitter, 'denied').subscribe(function (ev) {
    return rxRepState._subjects.denied.next(ev);
  })); // docs


  rxRepState._subs.push(fromEvent(evEmitter, 'change').subscribe(function (ev) {
    if (rxRepState._subjects.docs.observers.length === 0 || ev.direction !== 'pull') return;
    ev.change.docs.filter(function (doc) {
      return doc.language !== 'query';
    }) // remove internal docs
    .map(function (doc) {
      return _handleFromStorageInstance(rxRepState.collection, doc);
    }) // do primary-swap and keycompression
    .forEach(function (doc) {
      return rxRepState._subjects.docs.next(doc);
    });
  })); // error


  rxRepState._subs.push(fromEvent(evEmitter, 'error').subscribe(function (ev) {
    return rxRepState._subjects.error.next(ev);
  })); // active


  rxRepState._subs.push(fromEvent(evEmitter, 'active').subscribe(function () {
    return rxRepState._subjects.active.next(true);
  }));

  rxRepState._subs.push(fromEvent(evEmitter, 'paused').subscribe(function () {
    return rxRepState._subjects.active.next(false);
  })); // complete


  rxRepState._subs.push(fromEvent(evEmitter, 'complete').subscribe( /*#__PURE__*/function () {
    var _ref = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime.mark(function _callee(info) {
      return _regeneratorRuntime.wrap(function _callee$(_context) {
        while (1) {
          switch (_context.prev = _context.next) {
            case 0:
              _context.next = 2;
              return promiseWait(100);

            case 2:
              rxRepState._subjects.complete.next(info);

            case 3:
            case "end":
              return _context.stop();
          }
        }
      }, _callee);
    }));

    return function (_x) {
      return _ref.apply(this, arguments);
    };
  }())); // auto-cancel one-time replications on complelete to not cause memory leak


  if (!rxRepState.syncOptions.options || !rxRepState.syncOptions.options.live) {
    rxRepState._subs.push(rxRepState.complete$.pipe(filter(function (x) {
      return !!x;
    }), first(), mergeMap(function () {
      return rxRepState.collection.database.requestIdlePromise().then(function () {
        return rxRepState.cancel();
      });
    })).subscribe());
  }

  function getIsAlive(emitter) {
    // "state" will live in emitter.state if single direction replication
    // or in emitter.push.state & emitter.pull.state when syncing for both
    var state = emitter.state;

    if (!state) {
      state = [emitter.pull.state, emitter.push.state].reduce(function (acc, val) {
        if (acc === 'active' || val === 'active') return 'active';
        return acc === 'stopped' ? acc : val;
      }, '');
    } // If it's active, we can't determine whether the connection is active
    // or not yet


    if (state === 'active') {
      return promiseWait(15).then(function () {
        return getIsAlive(emitter);
      });
    }

    var isAlive = state !== 'stopped';
    return Promise.resolve(isAlive);
  }

  rxRepState._subs.push(fromEvent(evEmitter, 'paused').pipe(skipUntil(fromEvent(evEmitter, 'active'))).subscribe(function () {
    getIsAlive(rxRepState._pouchEventEmitterObject).then(function (isAlive) {
      return rxRepState._subjects.alive.next(isAlive);
    });
  }));
}
export function createRxCouchDBReplicationState(collection, syncOptions) {
  return new RxCouchDBReplicationStateBase(collection, syncOptions);
}
export function syncCouchDB(_ref2) {
  var _this2 = this;

  var remote = _ref2.remote,
      _ref2$waitForLeadersh = _ref2.waitForLeadership,
      waitForLeadership = _ref2$waitForLeadersh === void 0 ? true : _ref2$waitForLeadersh,
      _ref2$direction = _ref2.direction,
      direction = _ref2$direction === void 0 ? {
    pull: true,
    push: true
  } : _ref2$direction,
      _ref2$options = _ref2.options,
      options = _ref2$options === void 0 ? {
    live: true,
    retry: true
  } : _ref2$options,
      query = _ref2.query;
  var useOptions = flatClone(options); // prevent #641 by not allowing internal pouchdbs as remote

  if (isInstanceOfPouchDB(remote) && INTERNAL_POUCHDBS.has(remote)) {
    throw newRxError('RC3', {
      database: this.database.name,
      collection: this.name
    });
  } // if remote is RxCollection, get internal pouchdb


  if (isRxCollection(remote)) {
    remote = remote.storageInstance.internals.pouch;
  }

  if (query && this !== query.collection) {
    throw newRxError('RC2', {
      query: query
    });
  }

  var syncFun = pouchReplicationFunction(this.storageInstance.internals.pouch, direction);

  if (query) {
    useOptions.selector = query.toJSON().selector;
  }

  var repState = createRxCouchDBReplicationState(this, {
    remote: remote,
    waitForLeadership: waitForLeadership,
    direction: direction,
    options: options,
    query: query
  }); // run internal so .sync() does not have to be async

  var waitTillRun = waitForLeadership && this.database.multiInstance // do not await leadership if not multiInstance
  ? this.database.waitForLeadership() : promiseWait(0);
  waitTillRun.then(function () {
    if (_this2.destroyed || repState.canceled) {
      return;
    }

    var pouchSync = syncFun(remote, useOptions);
    setPouchEventEmitter(repState, pouchSync);

    _this2._repStates.add(repState);
  });
  return repState;
}
export var rxdb = true;
export var prototypes = {
  RxCollection: function RxCollection(proto) {
    proto.syncCouchDB = syncCouchDB;
  }
};
export var hooks = {
  createRxCollection: function createRxCollection(collection) {
    var pouch = collection.storageInstance.internals.pouch;

    if (pouch) {
      INTERNAL_POUCHDBS.add(collection.storageInstance.internals.pouch);
    }
  }
};
export var RxDBReplicationCouchDBPlugin = {
  name: 'replication-couchdb',
  rxdb: rxdb,
  prototypes: prototypes,
  hooks: hooks
};
//# sourceMappingURL=replication-couchdb.js.map