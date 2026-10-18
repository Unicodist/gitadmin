const fs = require('fs');
const path = require('path');

// The git distribution of dugite links its commands to the git binary. Packaging
// copies each link as a full binary, which makes the app several times larger,
// so the links are restored in the copy.
function restoreGitLinks(buildPath) {
  const relativeDir = path.join('node_modules', 'dugite', 'git', 'libexec', 'git-core');
  const sourceDir = path.join(__dirname, relativeDir);
  const targetDir = path.join(buildPath, relativeDir);
  if (!fs.existsSync(sourceDir) || !fs.existsSync(targetDir)) {
    return;
  }
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      const target = path.join(targetDir, entry.name);
      fs.rmSync(target, { force: true });
      fs.symlinkSync(fs.readlinkSync(path.join(sourceDir, entry.name)), target);
    }
  }
}

module.exports = {
  packagerConfig: {
    // Lowercase so it matches the default binary name the deb and rpm makers look for
    executableName: 'gitadmin',
    asar: {
      // dugite runs the git distribution it ships, which cannot be executed from the archive
      unpack: '**/node_modules/dugite/git/**'
    },
    ignore: [
      /^\/src($|\/)/,
      /^\/test($|\/)/,
      /^\/build-test($|\/)/,
      /^\/out($|\/)/,
      /^\/test-results($|\/)/,
      /^\/\.github($|\/)/,
      /^\/assets\/less($|\/)/,
      // Only the AMD build of Monaco is used
      /^\/node_modules\/monaco-editor\/(esm|dev|min-maps)($|\/)/,
      /^\/(tsconfig.*\.json|eslint\.config\.mjs|forge\.config\.js|playwright\.config\.ts|\.nvmrc)$/
    ]
  },
  hooks: {
    packageAfterCopy: async (config, buildPath, electronVersion, platform) => {
      if (platform !== 'win32') {
        restoreGitLinks(buildPath);
      }
    }
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux', 'win32']
    },
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'gitadmin'
      }
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {}
    },
    {
      name: '@electron-forge/maker-deb',
      config: {}
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {}
    },
    {
      // A single file that runs without installation on most Linux distributions
      name: '@reforged/maker-appimage',
      config: {
        options: {
          categories: ['Development']
        }
      }
    }
  ]
};
