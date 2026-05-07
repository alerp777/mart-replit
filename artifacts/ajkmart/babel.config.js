module.exports = function (api) {
  api.cache(true);
  const isProduction = api.env("production");
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: isProduction ? [["transform-remove-console", { exclude: ["error"] }]] : [],
  };
};
