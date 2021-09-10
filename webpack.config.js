const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const RemovePlugin = require("remove-files-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const terser = require("terser");
const WebpackConcatPlugin = require("webpack-concat-files-plugin");

module.exports = {
  entry: [
    "./dist/angular-web-component/main.js",
    "./dist/angular-web-component/polyfills.js",
    "./dist/angular-web-component/runtime.js",
  ],
  // watch: true,

  mode: "production",

  // output: {
  //   path: path.resolve(__dirname, "build/angular-web-component"),
  //   filename: "main.js",
  // },

  plugins: [
    new HtmlWebpackPlugin({
      template: "./src/base.html",
    }),
    new RemovePlugin({
      // after: {
      //   include: ["./dist"],
      // },
      before: {
        test: [
          {
            folder: "./build/angular-web-component",
            method: (absoluteItemPath) => {
              console.log(absoluteItemPath);
              return new RegExp(/final\.?(.*)/, "m").test(absoluteItemPath);
            },
          },
        ],
      },
    }),
    // new CopyWebpackPlugin([
    //   { from: "./src/webphone.js", to: "./build/angular-web-component" },
    // ]),
    new WebpackConcatPlugin({
      bundles: [
        {
          src: [
            "./dist/angular-web-component/main.js",
            "./dist/angular-web-component/polyfills.js",
            "./dist/angular-web-component/runtime.js",
            "./src/webphone.js",
          ],
          dest: "./build/angular-web-component/final.js",
          transforms: {
            after: async (code) => {
              const minifiedCode = await terser.minify(code);
              return minifiedCode.code;
            },
          },
        },
      ],
    }),
  ],
};
