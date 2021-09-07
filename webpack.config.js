const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const RemovePlugin = require("remove-files-webpack-plugin");
module.exports = {
  entry: [
    "./dist/angular-web-component/main.js",
    "./dist/angular-web-component/polyfills.js",
    "./dist/angular-web-component/runtime.js",
  ],

  output: {
    path: path.resolve(__dirname, "build"),
  },

  plugins: [
    new HtmlWebpackPlugin({
      template: "./src/base.html",
    }),
    new RemovePlugin({
      after: {
        include: ["./dist"],
      },
    }),
  ],
};
