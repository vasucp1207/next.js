import path from 'path'
import { promises as fs } from 'fs'

import { webpack, sources } from 'next/dist/compiled/webpack/webpack'
import { WEBPACK_LAYERS } from '../../../lib/constants'
import { normalizeAppPath } from '../../../shared/lib/router/utils/app-paths'
import { isDynamicRoute } from '../../../shared/lib/router/utils'

const PLUGIN_NAME = 'NextTypesPlugin'

interface Options {
  dir: string
  distDir: string
  appDir: string
  dev: boolean
  isEdgeServer: boolean
  typedRoutes: boolean
}

function createTypeGuardFile(
  fullPath: string,
  relativePath: string,
  options: {
    type: 'layout' | 'page'
    slots?: string[]
  }
) {
  return `// File: ${fullPath}
import * as entry from '${relativePath}'
import type { ResolvingMetadata } from 'next/dist/lib/metadata/types/metadata-interface'

type TEntry = typeof entry

// Check that the entry is a valid entry
checkFields<Diff<{
  default: Function
  config?: {}
  generateStaticParams?: Function
  revalidate?: RevalidateRange<TEntry> | false
  dynamic?: 'auto' | 'force-dynamic' | 'error' | 'force-static'
  dynamicParams?: boolean
  fetchCache?: 'auto' | 'force-no-store' | 'only-no-store' | 'default-no-store' | 'default-cache' | 'only-cache' | 'force-cache'
  preferredRegion?: 'auto' | 'home' | 'edge'
  ${
    options.type === 'page'
      ? "runtime?: 'nodejs' | 'experimental-edge' | 'edge'"
      : ''
  }
  metadata?: any
  generateMetadata?: Function
}, TEntry, ''>>()

// Check the prop type of the entry function
checkFields<Diff<${
    options.type === 'page' ? 'PageProps' : 'LayoutProps'
  }, FirstArg<TEntry['default']>, 'default'>>()

// Check the arguments and return type of the generateMetadata function
if ('generateMetadata' in entry) {
  checkFields<Diff<${
    options.type === 'page' ? 'PageProps' : 'LayoutProps'
  }, FirstArg<MaybeField<TEntry, 'generateMetadata'>>, 'generateMetadata'>>()
  checkFields<Diff<ResolvingMetadata, SecondArg<MaybeField<TEntry, 'generateMetadata'>>, 'generateMetadata'>>()
}

// Check the arguments and return type of the generateStaticParams function
if ('generateStaticParams' in entry) {
  checkFields<Diff<{ params: PageParams }, FirstArg<MaybeField<TEntry, 'generateStaticParams'>>, 'generateStaticParams'>>()
  checkFields<Diff<{ __tag__: 'generateStaticParams', __return_type__: any[] | Promise<any[]> }, { __tag__: 'generateStaticParams', __return_type__: ReturnType<MaybeField<TEntry, 'generateStaticParams'>> }>>()
}
  
type PageParams = any
export interface PageProps {
  params?: any
  searchParams?: any
}
export interface LayoutProps {
  children: React.ReactNode
${
  options.slots
    ? options.slots.map((slot) => `  ${slot}: React.ReactNode`).join('\n')
    : ''
}
  params?: any
}

// =============
// Utility types
type RevalidateRange<T> = T extends { revalidate: any } ? NonNegative<T['revalidate']> : never

// If T is unknown or any, it will be an empty {} type. Otherwise, it will be the same as Omit<T, keyof Base>.
type OmitWithTag<T, K extends keyof any, _M> = Omit<T, K>
type Diff<Base, T extends Base, Message extends string = ''> = 0 extends (1 & T) ? {} : OmitWithTag<T, keyof Base, Message>

type FirstArg<T extends Function> = T extends (...args: [infer T, any]) => any ? unknown extends T ? any : T : never
type SecondArg<T extends Function> = T extends (...args: [any, infer T]) => any ? unknown extends T ? any : T : never
type MaybeField<T, K extends string> = T extends { [k in K]: infer G } ? G extends Function ? G : never : never

function checkFields<_ extends { [k in keyof any]: never }>() {}

// https://github.com/sindresorhus/type-fest
type Numeric = number | bigint
type Zero = 0 | 0n
type Negative<T extends Numeric> = T extends Zero ? never : \`\${T}\` extends \`-\${string}\` ? T : never
type NonNegative<T extends Numeric> = T extends Zero ? T : Negative<T> extends never ? T : '__invalid_negative_number__'
`
}

async function collectNamedSlots(layoutPath: string) {
  const layoutDir = path.dirname(layoutPath)
  const items = await fs.readdir(layoutDir, { withFileTypes: true })
  const slots = []
  for (const item of items) {
    if (item.isDirectory() && item.name.startsWith('@')) {
      slots.push(item.name.slice(1))
    }
  }
  return slots
}

const nodeRouteTypes: string[] = []
const edgeRouteTypes: string[] = []

export const pageFiles = new Set<string>()

function createRouteDefinitions() {
  const fallback =
    !edgeRouteTypes.length && !nodeRouteTypes.length ? 'string' : ''

  return `
type SearchOrHash = \`?\${string}\` | \`#\${string}\`
type Suffix = '' | SearchOrHash

type SafeSlug<S extends string> = 
  S extends \`\${string}/\${string}\`
    ? never
    : S extends \`\${string}\${SearchOrHash}\`
    ? never
    : S extends ''
    ? never
    : S

type CatchAllSlug<S extends string> = 
  S extends \`\${string}\${SearchOrHash}\`
    ? never
    : S extends ''
    ? never
    : S

type OptionalCatchAllSlug<S extends string> = 
  S extends \`\${string}\${SearchOrHash}\`
    ? never
    : S

type Route<T extends string = string> = ${fallback}
${
  edgeRouteTypes.map((route) => `  | ${route}`).join('\n') +
  nodeRouteTypes.map((route) => `  | ${route}`).join('\n')
}

declare module 'next/link' {
  import React from 'react'
  import { UrlObject } from 'url'
  import { LinkProps as OriginalLinkProps } from 'next/dist/client/link'

  type LinkRestProps = Omit<Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof OriginalLinkProps> & OriginalLinkProps, 'href'>;

  // If the href prop can be a Route type with an infer-able S, it's valid.
  type HrefProp<T> = T extends (Route<infer S> | UrlObject) ? {
    /**
     * The path or URL to navigate to. This is the only required prop. It can also be an object.
     *
     * https://nextjs.org/docs/api-reference/next/link
     */
    href: T
  } : {
    /**
     * The path or URL to navigate to. This is the only required prop. It can also be an object.
     *
     * https://nextjs.org/docs/api-reference/next/link
     */
    href: never
  }

  export type LinkProps<T> = LinkRestProps & HrefProp<T>
  export default function Link<RouteType>(props: LinkProps<RouteType>): JSX.Element
}

declare module 'next' {
  export { Route }
}`
}

export class NextTypesPlugin {
  dir: string
  distDir: string
  appDir: string
  pagesDir: string
  dev: boolean
  isEdgeServer: boolean
  typedRoutes: boolean

  constructor(options: Options) {
    this.dir = options.dir
    this.distDir = options.distDir
    this.appDir = options.appDir
    this.dev = options.dev
    this.isEdgeServer = options.isEdgeServer
    this.pagesDir = path.join(this.appDir, '..', 'pages')
    this.typedRoutes = options.typedRoutes
  }

  collectPage(filePath: string) {
    if (!this.typedRoutes) return

    const isApp = filePath.startsWith(this.appDir + path.sep)

    // Filter out non-page files in app dir
    if (isApp && !/[/\\]page\.[^.]+$/.test(filePath)) {
      return
    }

    // Filter out non-page files in pages dir
    if (
      !isApp &&
      /[/\\](?:_app|_document|_error|404|500)\.[^.]+$/.test(filePath)
    ) {
      return
    }

    const page = isApp
      ? normalizeAppPath(path.relative(this.appDir, filePath))
      : '/' + path.relative(this.pagesDir, filePath)

    let route =
      (isApp
        ? page.replace(/[/\\]page\.[^./]+$/, '')
        : page.replace(/\.[^./]+$/, '').replace(/[/\\]index$/, '')
      ).replace(/\\/g, '/') || '/'

    if (isDynamicRoute(route)) {
      route = route
        .split('/')
        .map((part) => {
          if (part.startsWith('[') && part.endsWith(']')) {
            if (part.startsWith('[...')) {
              // /[...slug]
              return `\${CatchAllSlug<T>}`
            } else if (part.startsWith('[[...') && part.endsWith(']]')) {
              // /[[...slug]]
              return `\${OptionalCatchAllSlug<T>}`
            }
            // /[slug]
            return `\${SafeSlug<T>}`
          }
          return part
        })
        .join('/')
    }

    ;(this.isEdgeServer ? edgeRouteTypes : nodeRouteTypes).push(
      `\`${route}\${Suffix}\``
    )
  }

  apply(compiler: webpack.Compiler) {
    // From dist root to project root
    const distDirRelative = path.relative(this.distDir + '/..', '.')

    // From asset root to dist root
    const assetDirRelative = this.dev
      ? '..'
      : this.isEdgeServer
      ? '..'
      : '../..'

    const handleModule = async (_mod: webpack.Module, assets: any) => {
      const mod: webpack.NormalModule = _mod as any

      if (!mod.resource) return

      if (!/\.(js|jsx|ts|tsx|mjs)$/.test(mod.resource)) return

      if (!mod.resource.startsWith(this.appDir + path.sep)) {
        if (!this.dev) {
          if (mod.resource.startsWith(this.pagesDir + path.sep)) {
            this.collectPage(mod.resource)
          }
        }
        return
      }

      if (_mod.layer !== WEBPACK_LAYERS.server) return

      const IS_LAYOUT = /[/\\]layout\.[^./\\]+$/.test(mod.resource)
      const IS_PAGE = !IS_LAYOUT && /[/\\]page\.[^.]+$/.test(mod.resource)
      const relativePathToApp = path.relative(this.appDir, mod.resource)
      const relativePathToRoot = path.relative(this.dir, mod.resource)

      if (!this.dev) {
        if (IS_PAGE) {
          this.collectPage(mod.resource)
        }
      }

      const typePath = path.join(
        'types',
        'app',
        relativePathToApp.replace(/\.(js|jsx|ts|tsx|mjs)$/, '.ts')
      )
      const relativeImportPath = path
        .join(
          distDirRelative,
          path.relative(typePath, ''),
          relativePathToRoot.replace(/\.(js|jsx|ts|tsx|mjs)$/, '')
        )
        .replace(/\\/g, '/')
      const assetPath = assetDirRelative + '/' + typePath.replace(/\\/g, '/')

      if (IS_LAYOUT) {
        const slots = await collectNamedSlots(mod.resource)
        assets[assetPath] = new sources.RawSource(
          createTypeGuardFile(mod.resource, relativeImportPath, {
            type: 'layout',
            slots,
          })
        ) as unknown as webpack.sources.RawSource
      } else if (IS_PAGE) {
        assets[assetPath] = new sources.RawSource(
          createTypeGuardFile(mod.resource, relativeImportPath, {
            type: 'page',
          })
        ) as unknown as webpack.sources.RawSource
      }
    }

    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
      compilation.hooks.processAssets.tapAsync(
        {
          name: PLUGIN_NAME,
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_HASH,
        },
        async (assets, callback) => {
          const promises: Promise<any>[] = []

          // Clear routes
          if (this.isEdgeServer) {
            edgeRouteTypes.length = 0
          } else {
            nodeRouteTypes.length = 0
          }

          compilation.chunkGroups.forEach((chunkGroup: any) => {
            chunkGroup.chunks.forEach((chunk: webpack.Chunk) => {
              if (!chunk.name) return

              // Here we only track page chunks.
              if (
                !chunk.name.startsWith('pages/') &&
                !(chunk.name.startsWith('app/') && chunk.name.endsWith('/page'))
              ) {
                return
              }

              const chunkModules =
                compilation.chunkGraph.getChunkModulesIterable(
                  chunk
                ) as Iterable<webpack.NormalModule>
              for (const mod of chunkModules) {
                promises.push(handleModule(mod, assets))

                // If this is a concatenation, register each child to the parent ID.
                const anyModule = mod as any
                if (anyModule.modules) {
                  anyModule.modules.forEach((concatenatedMod: any) => {
                    promises.push(handleModule(concatenatedMod, assets))
                  })
                }
              }
            })
          })

          await Promise.all(promises)

          if (this.typedRoutes) {
            pageFiles.forEach((file) => {
              this.collectPage(file)
            })

            const linkTypePath = path.join('types', 'link.d.ts')
            const assetPath =
              assetDirRelative + '/' + linkTypePath.replace(/\\/g, '/')
            assets[assetPath] = new sources.RawSource(
              createRouteDefinitions()
            ) as unknown as webpack.sources.RawSource
          }

          callback()
        }
      )
    })
  }
}
