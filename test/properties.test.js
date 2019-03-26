require('@babel/polyfill')
const fs = require('fs')
const path = require('path')

const webpack = require('webpack')
const get = require('lodash.get')
const globby = require('globby')
const rimraf = require('rimraf')

const ExtractPlugin = require('./../dist/cjs')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')

const runWebpackWith = (userConfig, suite) => {
  const randomString = Math.random()
    .toString(36)
    .substring(7)
  const outputPath = path.join(__dirname, `cases/${suite}/dist/${randomString}`)
  const config = Object.assign(userConfig, {
    context: path.join(__dirname, `cases/${suite}`),
    output: {
      path: outputPath,
    },
    module: {
      rules: get(userConfig, 'module.rules') || userConfig.loaders,
    },
    plugins: userConfig.plugins,
  })

  delete config.loaders

  return new Promise((resolve, reject) => {
    webpack(config, async (error, stats) => {
      if (error) {
        reject(error)
      }
      let outputs = await globby(['*.*'], {
        cwd: outputPath,
      })
      outputs = outputs.reduce((accumulator, output) => {
        const fileContents = fs
          .readFileSync(path.join(outputPath, output))
          .toString()
        return {
          ...accumulator,
          [output]: fileContents,
        }
      }, {})
      expect(stats.compilation.errors).toEqual([])
      resolve(outputs)
    })
  })
}

beforeAll((done) => {
  rimraf(path.join(__dirname, 'cases/properties/dist'), done)
})

test('extract all properties from .properties files', async () => {
  const output = await runWebpackWith(
    {
      entry: './src/properties.js',
      loaders: [
        {
          test: /\.properties$/,
          use: [
            {
              loader: ExtractPlugin.loader,
            },
            'raw-loader',
          ],
        },
      ],
      plugins: [
        new ExtractPlugin({
          filename: 'frontend.properties',
        }),
      ],
    },
    'properties'
  )

  expect(output['main.js']).toBeDefined()
  expect(output['frontend.properties']).toMatchSnapshot()
})

test('extract all properties and name the result like the main chunk', async () => {
  const output = await runWebpackWith(
    {
      entry: './src/properties.js',
      loaders: [
        {
          test: /\.properties$/,
          use: [
            {
              loader: ExtractPlugin.loader,
            },
            'raw-loader',
          ],
        },
      ],
      plugins: [
        new ExtractPlugin({
          filename: '[name].properties',
        }),
      ],
    },
    'properties'
  )

  expect(output['main.js']).toBeDefined()
  expect(output['main.properties']).toBeDefined()
})

test('remove new lines at the end of each file when the option is set', async () => {
  const output = await runWebpackWith(
    {
      entry: './src/properties.js',
      loaders: [
        {
          test: /\.properties$/,
          use: [
            {
              loader: ExtractPlugin.loader,
            },
            'raw-loader',
          ],
        },
      ],
      plugins: [
        new ExtractPlugin({
          filename: '[name].properties',
          removeNewLine: true,
        }),
      ],
    },
    'properties'
  )

  expect(output['main.properties']).toMatchSnapshot()
})

test('works alongside mini-css-webpack-plugin', async () => {
  const output = await runWebpackWith(
    {
      entry: './src/index.js',
      loaders: [
        {
          test: /\.css$/,
          use: [
            {
              loader: MiniCssExtractPlugin.loader,
            },
            'css-loader',
          ]
        },
        {
          test: /\.properties$/,
          use: [
            {
              loader: ExtractPlugin.loader,
            },
            'raw-loader',
          ],
        },
      ],
      plugins: [
        new MiniCssExtractPlugin({
          filename: '[name].css',
        }),
        new ExtractPlugin({
          filename: '[name].properties',
        }),
      ],
    },
    'legacy'
  )

  expect(output['main.css']).toMatchSnapshot()
  expect(output['main.properties']).toMatchSnapshot()
})
