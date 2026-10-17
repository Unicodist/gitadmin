# Gitadmin

Gitadmin is a modern graphical user interface for Git. It is open-source, multiplatform and easy to use. It is based on [gitamine](https://github.com/pvigier/gitamine) by Pierre Vigier.

The main features of Gitadmin are:

* Beautiful and readable commit graph
* Syntax highlighting
* Themeable (light and dark modes available)
* Automatic refresh
* No account required and no telemetry

Gitadmin is powered by awesome technologies including:

* [TypeScript](https://www.typescriptlang.org/)
* [Node.js](https://nodejs.org/)
* [Electron](https://electronjs.org/)
* [React](https://reactjs.org/)
* [Monaco](https://github.com/Microsoft/monaco-editor)
* [Git](https://git-scm.com/), bundled with [dugite](https://github.com/desktop/dugite)
* [chokidar](https://github.com/paulmillr/chokidar)

If you want to know more about the commit graph drawing algorithm, you can read this [article](https://pvigier.github.io/2019/05/06/commit-graph-drawing-algorithms.html).

## Running from source

```
npm install
npm start
```

Run `npm run make` to build installers for your platform.

## Development

You need [Node.js](https://nodejs.org/) 24 (see `.nvmrc`). Git does not need to be installed, the app ships its own copy through dugite.

```sh
npm install
npm start          # build and run the app
npm test           # unit tests, and integration tests of the git layer
npm run test:e2e   # end-to-end tests of the app (uses xvfb-run on Linux CI)
npm run lint
npm run typecheck
npm run package    # package the app for the current platform
npm run make       # build the installers for the current platform
```

The stylesheet is written in LESS in `assets/less` and compiled to `assets/css` by `npm run build` (or `npm run build:css` alone). The colors come from the themes in `assets/themes`.

The end-to-end tests compare screenshots of the main views in the light and dark themes with the images of `test/e2e/screenshots.spec.ts-snapshots`. They run on Linux only. After a visual change, record them again with `npm run test:e2e:update-snapshots` (with `xvfb-run -a` on a Linux machine without a display), check the new images and commit them.

## Contributing

Here are some ways, you can contribute to Gitadmin:

* Found a bug, please create an issue, I will try to fix it as quickly as possible.
* Want to fix an issue or add a feature yourself, do a pull request.
* If you are a designer, Gitadmin needs an application icon and some icons for the user interface, you are more than welcome.
* If you want to become an active maintainer, please contact me.

## Screenshots

![Commit graph and index in the light theme](test/e2e/screenshots.spec.ts-snapshots/index-light-linux.png)
![Diff of a file in the dark theme](test/e2e/screenshots.spec.ts-snapshots/diff-dark-linux.png)

## License

Gitadmin is distributed under the [GNU GENERAL PUBLIC LICENSE version 3](https://www.gnu.org/licenses/gpl-3.0.en.html).

You are free to use Gitadmin for non-commercial and commercial projects without any restriction.
