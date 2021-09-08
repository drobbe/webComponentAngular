const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const RemovePlugin = require("remove-files-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = {
  entry: [
    "./dist/angular-web-component/main.js",
    "./dist/angular-web-component/polyfills.js",
    "./dist/angular-web-component/runtime.js",
  ],
  // watch: true,

  mode: "production",

  output: {
    path: path.resolve(__dirname, "build/angular-web-component"),
    filename: "[name].[contenthash].js",
  },

  plugins: [
    new HtmlWebpackPlugin({
      template: "./src/base.html",
    }),
    new RemovePlugin({
      after: {
        include: ["./dist"],
      },
      before: {
        include: ["./build"],
        folder: "./build/angular-web-component",
        method: (absoluteItemPath) => {
          return new RegExp(/\main\.map$/, "m").test(absoluteItemPath);
        },
      },
    }),
    // new CopyWebpackPlugin([
    //   { from: "./src/webphone.js", to: "./build/angular-web-component" },
    // ]),
  ],
};
