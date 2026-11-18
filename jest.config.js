// Os pacotes server/ e client/ são ESM ("type": "module"), então o Jest roda
// em modo ESM nativo (veja o script "test", que usa --experimental-vm-modules)
// e não precisa de transformação via Babel.
module.exports = {
  testEnvironment: "node",
  transform: {},
  testMatch: ["<rootDir>/server/tests/**/*.test.js", "<rootDir>/client/tests/**/*.test.js"],
  collectCoverageFrom: [
    "server/src/{parseUrl,cache,bitbucket}.js",
    "client/src/{heatmapCore,exporters,api}.js",
  ],
};
