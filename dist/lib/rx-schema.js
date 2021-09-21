"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getIndexes = getIndexes;
exports.getPrimaryFieldOfPrimaryKey = getPrimaryFieldOfPrimaryKey;
exports.getComposedPrimaryKeyOfDocumentData = getComposedPrimaryKeyOfDocumentData;
exports.getPreviousVersions = getPreviousVersions;
exports.getFinalFields = getFinalFields;
exports.normalize = normalize;
exports.fillWithDefaultSettings = fillWithDefaultSettings;
exports.createRxSchema = createRxSchema;
exports.isInstanceOf = isInstanceOf;
exports.RxSchema = void 0;

var _createClass2 = _interopRequireDefault(require("@babel/runtime/helpers/createClass"));

var _deepEqual = _interopRequireDefault(require("deep-equal"));

var _objectPath = _interopRequireDefault(require("object-path"));

var _util = require("./util");

var _rxError = require("./rx-error");

var _hooks = require("./hooks");

var _rxDocument = require("./rx-document");

var RxSchema = /*#__PURE__*/function () {
  function RxSchema(jsonSchema) {
    this.jsonSchema = jsonSchema;
    this.indexes = getIndexes(this.jsonSchema); // primary is always required

    this.primaryPath = getPrimaryFieldOfPrimaryKey(this.jsonSchema.primaryKey); // final fields are always required

    this.finalFields = getFinalFields(this.jsonSchema);
    this.jsonSchema.required = this.jsonSchema.required.concat(this.finalFields).filter(function (field) {
      return !field.includes('.');
    }).filter(function (elem, pos, arr) {
      return arr.indexOf(elem) === pos;
    }); // unique;
  }

  var _proto = RxSchema.prototype;

  /**
   * checks if a given change on a document is allowed
   * Ensures that:
   * - primary is not modified
   * - final fields are not modified
   * @throws {Error} if not valid
   */
  _proto.validateChange = function validateChange(dataBefore, dataAfter) {
    var _this = this;

    this.finalFields.forEach(function (fieldName) {
      if (!(0, _deepEqual["default"])(dataBefore[fieldName], dataAfter[fieldName])) {
        throw (0, _rxError.newRxError)('DOC9', {
          dataBefore: dataBefore,
          dataAfter: dataAfter,
          fieldName: fieldName,
          schema: _this.jsonSchema
        });
      }
    });
  }
  /**
   * validate if the obj matches the schema
   * @overwritten by plugin (required)
   * @param schemaPath if given, validates agains deep-path of schema
   * @throws {Error} if not valid
   * @param obj equal to input-obj
   */
  ;

  _proto.validate = function validate(_obj, _schemaPath) {
    throw (0, _util.pluginMissing)('validate');
  }
  /**
   * fills all unset fields with default-values if set
   */
  ;

  _proto.fillObjectWithDefaults = function fillObjectWithDefaults(obj) {
    obj = (0, _util.clone)(obj);
    Object.entries(this.defaultValues).filter(function (_ref) {
      var k = _ref[0];
      return !obj.hasOwnProperty(k) || typeof obj[k] === 'undefined';
    }).forEach(function (_ref2) {
      var k = _ref2[0],
          v = _ref2[1];
      return obj[k] = v;
    });
    return obj;
  }
  /**
   * creates the schema-based document-prototype,
   * see RxCollection.getDocumentPrototype()
   */
  ;

  _proto.getDocumentPrototype = function getDocumentPrototype() {
    var proto = {};
    (0, _rxDocument.defineGetterSetter)(this, proto, '');
    (0, _util.overwriteGetterForCaching)(this, 'getDocumentPrototype', function () {
      return proto;
    });
    return proto;
  };

  _proto.getPrimaryOfDocumentData = function getPrimaryOfDocumentData(documentData) {
    return getComposedPrimaryKeyOfDocumentData(this.jsonSchema, documentData);
  };

  _proto.fillPrimaryKey = function fillPrimaryKey(documentData) {
    var cloned = (0, _util.flatClone)(documentData);
    var newPrimary = getComposedPrimaryKeyOfDocumentData(this.jsonSchema, documentData);
    var existingPrimary = documentData[this.primaryPath];

    if (existingPrimary && existingPrimary !== newPrimary) {
      throw (0, _rxError.newRxError)('DOC19', {
        args: {
          documentData: documentData,
          existingPrimary: existingPrimary,
          newPrimary: newPrimary
        },
        schema: this.jsonSchema
      });
    }

    cloned[this.primaryPath] = newPrimary;
    return cloned;
  };

  (0, _createClass2["default"])(RxSchema, [{
    key: "version",
    get: function get() {
      return this.jsonSchema.version;
    }
  }, {
    key: "normalized",
    get: function get() {
      return (0, _util.overwriteGetterForCaching)(this, 'normalized', normalize(this.jsonSchema));
    }
  }, {
    key: "topLevelFields",
    get: function get() {
      return Object.keys(this.normalized.properties);
    }
  }, {
    key: "defaultValues",
    get: function get() {
      var values = {};
      Object.entries(this.normalized.properties).filter(function (_ref3) {
        var v = _ref3[1];
        return v.hasOwnProperty('default');
      }).forEach(function (_ref4) {
        var k = _ref4[0],
            v = _ref4[1];
        return values[k] = v["default"];
      });
      return (0, _util.overwriteGetterForCaching)(this, 'defaultValues', values);
    }
    /**
        * true if schema contains at least one encrypted path
        */

  }, {
    key: "crypt",
    get: function get() {
      if (!!this.jsonSchema.encrypted && this.jsonSchema.encrypted.length > 0 || this.jsonSchema.attachments && this.jsonSchema.attachments.encrypted) {
        return true;
      } else {
        return false;
      }
    }
    /**
     * get all encrypted paths
     */

  }, {
    key: "encryptedPaths",
    get: function get() {
      return this.jsonSchema.encrypted || [];
    }
    /**
     * @overrides itself on the first call
     */

  }, {
    key: "hash",
    get: function get() {
      return (0, _util.overwriteGetterForCaching)(this, 'hash', (0, _util.hash)(this.normalized));
    }
  }]);
  return RxSchema;
}();

exports.RxSchema = RxSchema;

function getIndexes(jsonSchema) {
  return (jsonSchema.indexes || []).map(function (index) {
    return Array.isArray(index) ? index : [index];
  });
}

function getPrimaryFieldOfPrimaryKey(primaryKey) {
  if (typeof primaryKey === 'string') {
    return primaryKey;
  } else {
    return primaryKey.key;
  }
}
/**
 * Returns the composed primaryKey of a document by its data.
 */


function getComposedPrimaryKeyOfDocumentData(jsonSchema, documentData) {
  if (typeof jsonSchema.primaryKey === 'string') {
    return documentData[jsonSchema.primaryKey];
  }

  var compositePrimary = jsonSchema.primaryKey;
  return compositePrimary.fields.map(function (field) {
    var value = _objectPath["default"].get(documentData, field);

    if (typeof value === 'undefined') {
      throw (0, _rxError.newRxError)('DOC18', {
        args: {
          field: field,
          documentData: documentData
        }
      });
    }

    return value;
  }).join(compositePrimary.separator);
}
/**
 * array with previous version-numbers
 */


function getPreviousVersions(schema) {
  var version = schema.version ? schema.version : 0;
  var c = 0;
  return new Array(version).fill(0).map(function () {
    return c++;
  });
}
/**
 * returns the final-fields of the schema
 * @return field-names of the final-fields
 */


function getFinalFields(jsonSchema) {
  var ret = Object.keys(jsonSchema.properties).filter(function (key) {
    return jsonSchema.properties[key]["final"];
  }); // primary is also final

  var primaryPath = getPrimaryFieldOfPrimaryKey(jsonSchema.primaryKey);
  ret.push(primaryPath); // fields of composite primary are final

  if (typeof jsonSchema.primaryKey !== 'string') {
    jsonSchema.primaryKey.fields.forEach(function (field) {
      return ret.push(field);
    });
  }

  return ret;
}
/**
 * orders the schemas attributes by alphabetical order
 * @return jsonSchema - ordered
 */


function normalize(jsonSchema) {
  var normalizedSchema = (0, _util.sortObject)((0, _util.clone)(jsonSchema));

  if (jsonSchema.indexes) {
    normalizedSchema.indexes = Array.from(jsonSchema.indexes); // indexes should remain unsorted
  }

  return normalizedSchema;
}
/**
 * fills the schema-json with default-settings
 * @return cloned schemaObj
 */


function fillWithDefaultSettings(schemaObj) {
  schemaObj = (0, _util.clone)(schemaObj); // additionalProperties is always false

  schemaObj.additionalProperties = false; // fill with key-compression-state ()

  if (!schemaObj.hasOwnProperty('keyCompression')) {
    schemaObj.keyCompression = false;
  } // indexes must be array


  schemaObj.indexes = schemaObj.indexes || []; // required must be array

  schemaObj.required = schemaObj.required || []; // encrypted must be array

  schemaObj.encrypted = schemaObj.encrypted || [];
  /**
   * TODO we should not need to added the internal fields to the schema.
   * Better remove the before validation.
   */
  // add _rev

  schemaObj.properties._rev = {
    type: 'string',
    minLength: 1
  }; // add attachments

  schemaObj.properties._attachments = {
    type: 'object'
  }; // add deleted flag

  schemaObj.properties._deleted = {
    type: 'boolean'
  }; // version is 0 by default

  schemaObj.version = schemaObj.version || 0;
  return schemaObj;
}

function createRxSchema(jsonSchema) {
  var runPreCreateHooks = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

  if (runPreCreateHooks) {
    (0, _hooks.runPluginHooks)('preCreateRxSchema', jsonSchema);
  }

  var schema = new RxSchema(fillWithDefaultSettings(jsonSchema));
  (0, _hooks.runPluginHooks)('createRxSchema', schema);
  return schema;
}

function isInstanceOf(obj) {
  return obj instanceof RxSchema;
}

//# sourceMappingURL=rx-schema.js.map