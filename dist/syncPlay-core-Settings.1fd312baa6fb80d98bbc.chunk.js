"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(self["webpackChunk"] = self["webpackChunk"] || []).push([["syncPlay-core-Settings"],{

/***/ "./plugins/syncPlay/core/Settings.js":
/*!*******************************************!*\
  !*** ./plugins/syncPlay/core/Settings.js ***!
  \*******************************************/
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   getSetting: function() { return /* binding */ getSetting; },\n/* harmony export */   setSetting: function() { return /* binding */ setSetting; }\n/* harmony export */ });\n/* harmony import */ var _scripts_settings_appSettings__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../../scripts/settings/appSettings */ \"./scripts/settings/appSettings.js\");\n/**\n * Module that manages SyncPlay settings.\n * @module components/syncPlay/core/Settings\n */\n\n\n/**\n * Prefix used when saving SyncPlay settings.\n */\nvar PREFIX = 'syncPlay';\n\n/**\n * Gets the value of a setting.\n * @param {string} name The name of the setting.\n * @returns {string} The value.\n */\nfunction getSetting(name) {\n  return _scripts_settings_appSettings__WEBPACK_IMPORTED_MODULE_0__[\"default\"].get(name, PREFIX);\n}\n\n/**\n * Sets the value of a setting. Triggers an update if the new value differs from the old one.\n * @param {string} name The name of the setting.\n * @param {Object} value The value of the setting.\n */\nfunction setSetting(name, value) {\n  return _scripts_settings_appSettings__WEBPACK_IMPORTED_MODULE_0__[\"default\"].set(name, value, PREFIX);\n}//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiLi9wbHVnaW5zL3N5bmNQbGF5L2NvcmUvU2V0dGluZ3MuanMiLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly8vLi9wbHVnaW5zL3N5bmNQbGF5L2NvcmUvU2V0dGluZ3MuanM/MTU3NSJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE1vZHVsZSB0aGF0IG1hbmFnZXMgU3luY1BsYXkgc2V0dGluZ3MuXG4gKiBAbW9kdWxlIGNvbXBvbmVudHMvc3luY1BsYXkvY29yZS9TZXR0aW5nc1xuICovXG5pbXBvcnQgYXBwU2V0dGluZ3MgZnJvbSAnLi4vLi4vLi4vc2NyaXB0cy9zZXR0aW5ncy9hcHBTZXR0aW5ncyc7XG5cbi8qKlxuICogUHJlZml4IHVzZWQgd2hlbiBzYXZpbmcgU3luY1BsYXkgc2V0dGluZ3MuXG4gKi9cbmNvbnN0IFBSRUZJWCA9ICdzeW5jUGxheSc7XG5cbi8qKlxuICogR2V0cyB0aGUgdmFsdWUgb2YgYSBzZXR0aW5nLlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgVGhlIG5hbWUgb2YgdGhlIHNldHRpbmcuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBUaGUgdmFsdWUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRTZXR0aW5nKG5hbWUpIHtcbiAgICByZXR1cm4gYXBwU2V0dGluZ3MuZ2V0KG5hbWUsIFBSRUZJWCk7XG59XG5cbi8qKlxuICogU2V0cyB0aGUgdmFsdWUgb2YgYSBzZXR0aW5nLiBUcmlnZ2VycyBhbiB1cGRhdGUgaWYgdGhlIG5ldyB2YWx1ZSBkaWZmZXJzIGZyb20gdGhlIG9sZCBvbmUuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSBUaGUgbmFtZSBvZiB0aGUgc2V0dGluZy5cbiAqIEBwYXJhbSB7T2JqZWN0fSB2YWx1ZSBUaGUgdmFsdWUgb2YgdGhlIHNldHRpbmcuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRTZXR0aW5nKG5hbWUsIHZhbHVlKSB7XG4gICAgcmV0dXJuIGFwcFNldHRpbmdzLnNldChuYW1lLCB2YWx1ZSwgUFJFRklYKTtcbn1cbiJdLCJuYW1lcyI6W10sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///./plugins/syncPlay/core/Settings.js\n");

/***/ })

}]);