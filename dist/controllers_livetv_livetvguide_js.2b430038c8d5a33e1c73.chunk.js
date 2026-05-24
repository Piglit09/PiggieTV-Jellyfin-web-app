"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(self["webpackChunk"] = self["webpackChunk"] || []).push([["controllers_livetv_livetvguide_js"],{

/***/ "./controllers/livetv/livetvguide.js":
/*!*******************************************!*\
  !*** ./controllers/livetv/livetvguide.js ***!
  \*******************************************/
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": function() { return /* export default binding */ __WEBPACK_DEFAULT_EXPORT__; }\n/* harmony export */ });\n/* harmony import */ var _components_guide_guide__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../components/guide/guide */ \"./components/guide/guide.js\");\n\n/* harmony default export */ function __WEBPACK_DEFAULT_EXPORT__(view, params, tabContent) {\n  var guideInstance;\n  var self = this;\n  self.renderTab = function () {\n    if (!guideInstance) {\n      guideInstance = new _components_guide_guide__WEBPACK_IMPORTED_MODULE_0__[\"default\"]({\n        element: tabContent,\n        serverId: ApiClient.serverId()\n      });\n    }\n  };\n  self.onShow = function () {\n    if (guideInstance) {\n      guideInstance.resume();\n    }\n  };\n  self.onHide = function () {\n    if (guideInstance) {\n      guideInstance.pause();\n    }\n  };\n}//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiLi9jb250cm9sbGVycy9saXZldHYvbGl2ZXR2Z3VpZGUuanMiLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQTtBQUVBO0FBQ0E7QUFDQTtBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwic291cmNlcyI6WyJ3ZWJwYWNrOi8vLy4vY29udHJvbGxlcnMvbGl2ZXR2L2xpdmV0dmd1aWRlLmpzP2UxMDIiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IEd1aWRlIGZyb20gJy4uLy4uL2NvbXBvbmVudHMvZ3VpZGUvZ3VpZGUnO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiAodmlldywgcGFyYW1zLCB0YWJDb250ZW50KSB7XG4gICAgbGV0IGd1aWRlSW5zdGFuY2U7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG5cbiAgICBzZWxmLnJlbmRlclRhYiA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKCFndWlkZUluc3RhbmNlKSB7XG4gICAgICAgICAgICBndWlkZUluc3RhbmNlID0gbmV3IEd1aWRlKHtcbiAgICAgICAgICAgICAgICBlbGVtZW50OiB0YWJDb250ZW50LFxuICAgICAgICAgICAgICAgIHNlcnZlcklkOiBBcGlDbGllbnQuc2VydmVySWQoKVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgc2VsZi5vblNob3cgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmIChndWlkZUluc3RhbmNlKSB7XG4gICAgICAgICAgICBndWlkZUluc3RhbmNlLnJlc3VtZSgpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIHNlbGYub25IaWRlID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoZ3VpZGVJbnN0YW5jZSkge1xuICAgICAgICAgICAgZ3VpZGVJbnN0YW5jZS5wYXVzZSgpO1xuICAgICAgICB9XG4gICAgfTtcbn1cbiJdLCJuYW1lcyI6W10sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///./controllers/livetv/livetvguide.js\n");

/***/ })

}]);