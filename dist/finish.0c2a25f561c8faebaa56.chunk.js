"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(self["webpackChunk"] = self["webpackChunk"] || []).push([["finish"],{

/***/ "./apps/wizard/controllers/finish/index.js":
/*!*************************************************!*\
  !*** ./apps/wizard/controllers/finish/index.js ***!
  \*************************************************/
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": function() { return /* export default binding */ __WEBPACK_DEFAULT_EXPORT__; }\n/* harmony export */ });\n/* harmony import */ var components_loading_loading__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! components/loading/loading */ \"./components/loading/loading.ts\");\n/* harmony import */ var lib_jellyfin_apiclient__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! lib/jellyfin-apiclient */ \"./lib/jellyfin-apiclient/index.ts\");\n\n\nfunction onFinish() {\n  components_loading_loading__WEBPACK_IMPORTED_MODULE_0__[\"default\"].show();\n  var apiClient = lib_jellyfin_apiclient__WEBPACK_IMPORTED_MODULE_1__.ServerConnections.currentApiClient();\n  apiClient.ajax({\n    url: apiClient.getUrl('Startup/Complete'),\n    type: 'POST'\n  }).then(function () {\n    components_loading_loading__WEBPACK_IMPORTED_MODULE_0__[\"default\"].hide();\n    window.location.href = '';\n  });\n}\n/* harmony default export */ function __WEBPACK_DEFAULT_EXPORT__(view) {\n  view.querySelector('.btnWizardNext').addEventListener('click', onFinish);\n}//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiLi9hcHBzL3dpemFyZC9jb250cm9sbGVycy9maW5pc2gvaW5kZXguanMiLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUE7QUFDQTtBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFFQTtBQUNBO0FBQ0EiLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly8vLi9hcHBzL3dpemFyZC9jb250cm9sbGVycy9maW5pc2gvaW5kZXguanM/ZGE3YiJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgbG9hZGluZyBmcm9tICdjb21wb25lbnRzL2xvYWRpbmcvbG9hZGluZyc7XG5pbXBvcnQgeyBTZXJ2ZXJDb25uZWN0aW9ucyB9IGZyb20gJ2xpYi9qZWxseWZpbi1hcGljbGllbnQnO1xuXG5mdW5jdGlvbiBvbkZpbmlzaCgpIHtcbiAgICBsb2FkaW5nLnNob3coKTtcbiAgICBjb25zdCBhcGlDbGllbnQgPSBTZXJ2ZXJDb25uZWN0aW9ucy5jdXJyZW50QXBpQ2xpZW50KCk7XG4gICAgYXBpQ2xpZW50LmFqYXgoe1xuICAgICAgICB1cmw6IGFwaUNsaWVudC5nZXRVcmwoJ1N0YXJ0dXAvQ29tcGxldGUnKSxcbiAgICAgICAgdHlwZTogJ1BPU1QnXG4gICAgfSkudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAgIGxvYWRpbmcuaGlkZSgpO1xuICAgICAgICB3aW5kb3cubG9jYXRpb24uaHJlZiA9ICcnO1xuICAgIH0pO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiAodmlldykge1xuICAgIHZpZXcucXVlcnlTZWxlY3RvcignLmJ0bldpemFyZE5leHQnKS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIG9uRmluaXNoKTtcbn1cbiJdLCJuYW1lcyI6W10sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///./apps/wizard/controllers/finish/index.js\n");

/***/ })

}]);