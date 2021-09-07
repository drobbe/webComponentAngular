const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const RemovePlugin = require("remove-files-webpack-plugin");

module.exports = {
  entry: [
    "./dist/angular-web-component/main.js",
    "./dist/angular-web-component/polyfills.js",
    "./dist/angular-web-component/runtime.js",
  ],
  // watch: true,

  mode: "production",
  // devServer: {
  //   static: {
  //     directory: path.join(__dirname, "build"),
  //   },
  //   compress: true,
  //   port: 5000,
  // },

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
      },
    }),
  ],
};
