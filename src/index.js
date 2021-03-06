import fs from 'fs'
import path from 'path'

import webpack from 'webpack'
import sources from 'webpack-sources'

const { ConcatSource, SourceMapSource, OriginalSource } = sources
const {
  util: { createHash },
} = webpack

const NS = path.dirname(fs.realpathSync(__filename))

const pluginName = 'extract-plugin'

const REGEXP_CHUNKHASH = /\[chunkhash(?::(\d+))?\]/i
const REGEXP_CONTENTHASH = /\[contenthash(?::(\d+))?\]/i
const REGEXP_NAME = /\[name\]/i

class AnyDependency extends webpack.Dependency {
  constructor(
    { identifier, content, media, sourceMap },
    context,
    identifierIndex
  ) {
    super()
    this.identifier = identifier
    this.identifierIndex = identifierIndex
    this.content = typeof content.default !== 'undefined' ? content.default : content
    this.media = media
    this.sourceMap = sourceMap
    this.context = context
  }

  getResourceIdentifier() {
    return `any-module-${this.identifier}-${this.identifierIndex}`
  }
}

class AnyDependencyTemplate {
  apply() {}
}

class AnyModule extends webpack.Module {
  constructor(dependency) {
    super(NS, dependency.context)
    this._identifier = dependency.identifier
    this._identifierIndex = dependency.identifierIndex
    this.content = dependency.content
    this.media = dependency.media
    this.sourceMap = dependency.sourceMap
  }

  // no source() so webpack doesn't do add stuff to the bundle

  size() {
    return this.content.length
  }

  identifier() {
    return `any ${this._identifier} ${this._identifierIndex}`
  }

  readableIdentifier(requestShortener) {
    return `any ${requestShortener.shorten(this._identifier)}${
      this._identifierIndex ? ` (${this._identifierIndex})` : ''
    }`
  }

  nameForCondition() {
    const resource = this._identifier.split('!').pop()
    const idx = resource.indexOf('?')
    if (idx >= 0) return resource.substring(0, idx)
    return resource
  }

  updateCacheModule(module) {
    this.content = module.content
    this.media = module.media
    this.sourceMap = module.sourceMap
  }

  needRebuild() {
    return true
  }

  build(options, compilation, resolver, fileSystem, callback) {
    this.buildInfo = {}
    this.buildMeta = {}
    callback()
  }

  updateHash(hash) {
    super.updateHash(hash)
    hash.update(this.content)
    hash.update(this.media || '')
    hash.update(JSON.stringify(this.sourceMap || ''))
  }
}

class AnyModuleFactory {
  create(
    {
      dependencies: [dependency],
    },
    callback
  ) {
    callback(null, new AnyModule(dependency))
  }
}

class ExtractPlugin {
  constructor(options) {
    this.options = Object.assign(
      {
        filename: '[name].css',
      },
      options
    )
    if (!this.options.chunkFilename) {
      const { filename } = this.options
      const hasName = filename.includes('[name]')
      const hasId = filename.includes('[id]')
      const hasChunkHash = filename.includes('[chunkhash]')
      // Anything changing depending on chunk is fine
      if (hasChunkHash || hasName || hasId) {
        this.options.chunkFilename = filename
      } else {
        // Elsewise prefix '[id].' in front of the basename to make it changing
        this.options.chunkFilename = filename.replace(
          /(^|\/)([^/]*(?:\?|$))/,
          '$1[id].$2'
        )
      }
    }
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
      compilation.hooks.normalModuleLoader.tap(pluginName, (lc, m) => {
        const loaderContext = lc
        const module = m
        loaderContext[NS] = (content) => {
          if (!Array.isArray(content) && content != null) {
            throw new Error(
              `Exported value was not extracted as an array: ${JSON.stringify(
                content
              )}`
            )
          }
          // removeNewLine option added by extract-plugin
          if (this.options.removeNewLine && typeof content[0].content.default !== 'undefined') {
            // eslint-disable-next-line no-param-reassign
            content[0].content.default = content[0].content.default.replace(/\s+$/g, '')
          }
          const identifierCountMap = new Map()
          for (const line of content) {
            const count = identifierCountMap.get(line.identifier) || 0
            module.addDependency(new AnyDependency(line, m.context, count))
            identifierCountMap.set(line.identifier, count + 1)
          }
        }
      })
      compilation.dependencyFactories.set(AnyDependency, new AnyModuleFactory())
      compilation.dependencyTemplates.set(
        AnyDependency,
        new AnyDependencyTemplate()
      )
      compilation.mainTemplate.hooks.renderManifest.tap(
        pluginName,
        (result, { chunk }) => {
          const renderedModules = Array.from(chunk.modulesIterable).filter(
            (module) => module.type === NS
          )
          if (renderedModules.length > 0) {
            result.push({
              render: () =>
                this.renderContentAsset(
                  chunk,
                  renderedModules,
                  compilation.runtimeTemplate.requestShortener
                ),
              filenameTemplate: this.options.filename,
              pathOptions: {
                chunk,
                contentHashType: NS,
              },
              identifier: `${pluginName}.${chunk.id}`,
              hash: chunk.contentHash[NS],
            })
          }
        }
      )
      compilation.chunkTemplate.hooks.renderManifest.tap(
        pluginName,
        (result, { chunk }) => {
          const renderedModules = Array.from(chunk.modulesIterable).filter(
            (module) => module.type === NS
          )
          if (renderedModules.length > 0) {
            result.push({
              render: () =>
                this.renderContentAsset(
                  chunk,
                  renderedModules,
                  compilation.runtimeTemplate.requestShortener
                ),
              filenameTemplate: this.options.chunkFilename,
              pathOptions: {
                chunk,
                contentHashType: NS,
              },
              identifier: `${pluginName}.${chunk.id}`,
              hash: chunk.contentHash[NS],
            })
          }
        }
      )
      compilation.mainTemplate.hooks.hashForChunk.tap(
        pluginName,
        (hash, chunk) => {
          const { chunkFilename } = this.options
          if (REGEXP_CHUNKHASH.test(chunkFilename)) {
            hash.update(JSON.stringify(chunk.getChunkMaps(true).hash))
          }
          if (REGEXP_CONTENTHASH.test(chunkFilename)) {
            hash.update(
              JSON.stringify(chunk.getChunkMaps(true).contentHash[NS] || {})
            )
          }
          if (REGEXP_NAME.test(chunkFilename)) {
            hash.update(JSON.stringify(chunk.getChunkMaps(true).name))
          }
        }
      )
      compilation.hooks.contentHash.tap(pluginName, (chunk) => {
        const { outputOptions } = compilation
        const { hashFunction, hashDigest, hashDigestLength } = outputOptions
        const hash = createHash(hashFunction)
        for (const m of chunk.modulesIterable) {
          if (m.type === NS) {
            m.updateHash(hash)
          }
        }
        const { contentHash } = chunk
        contentHash[NS] = hash.digest(hashDigest).substring(0, hashDigestLength)
      })
      const { mainTemplate } = compilation
      mainTemplate.hooks.localVars.tap(pluginName, (source) => source)
      mainTemplate.hooks.requireEnsure.tap(pluginName, (source) => source)
    })
  }

  getCssChunkObject(mainChunk) {
    const obj = {}
    for (const chunk of mainChunk.getAllAsyncChunks()) {
      for (const module of chunk.modulesIterable) {
        if (module.type === NS) {
          obj[chunk.id] = 1
          break
        }
      }
    }
    return obj
  }

  renderContentAsset(chunk, modules, requestShortener) {
    // get first chunk group and take ordr from this one
    // When a chunk is shared between multiple chunk groups
    // with different order this can lead to wrong order
    // but it's not possible to create a correct order in
    // this case. Don't share chunks if you don't like it.
    const [chunkGroup] = chunk.groupsIterable
    if (typeof chunkGroup.getModuleIndex2 === 'function') {
      modules.sort(
        (a, b) => chunkGroup.getModuleIndex2(a) - chunkGroup.getModuleIndex2(b)
      )
    } else {
      // fallback for older webpack versions
      // (to avoid a breaking change)
      // TODO remove this in next mayor version
      // and increase minimum webpack version to 4.12.0
      modules.sort((a, b) => a.index2 - b.index2)
    }
    const source = new ConcatSource()
    const externalsSource = new ConcatSource()
    for (const m of modules) {
      if (/^@import url/.test(m.content)) {
        // HACK for IE
        // http://stackoverflow.com/a/14676665/1458162
        let { content } = m
        if (m.media) {
          // insert media into the @import
          // this is rar
          // TODO improve this and parse the CSS to support multiple medias
          content = content.replace(/;|\s*$/, m.media)
        }
        externalsSource.add(content)
        externalsSource.add('\n')
      } else {
        if (m.media) {
          source.add(`@media ${m.media} {\n`)
        }
        if (m.sourceMap) {
          source.add(
            new SourceMapSource(
              m.content,
              m.readableIdentifier(requestShortener),
              m.sourceMap
            )
          )
        } else {
          source.add(
            new OriginalSource(
              m.content,
              m.readableIdentifier(requestShortener)
            )
          )
        }
        source.add('\n')
        if (m.media) {
          source.add('}\n')
        }
      }
    }
    return new ConcatSource(externalsSource, source)
  }
}

ExtractPlugin.loader = require.resolve('./loader')

export default ExtractPlugin
