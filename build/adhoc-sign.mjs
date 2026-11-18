// electron-builder afterPack hook: ad-hoc signs the macOS app when no Developer ID
// certificate is available. An unsigned app gets no microphone prompt — macOS silently
// denies it — so every build must carry at least an ad-hoc signature and the entitlements.
// With CSC_LINK/CSC_NAME, a Developer ID identity in the keychain, or an explicit
// mac.identity, electron-builder signs (and notarizes) as usual and this hook does nothing.
import { execFileSync } from 'child_process'
import path from 'path'

function hasDeveloperId() {
  if (process.env.CSC_LINK || process.env.CSC_NAME) return true
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') return false
  try {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8'
    })
    return out.includes('Developer ID Application')
  } catch {
    return false
  }
}

export default async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const options = context.packager.platformSpecificBuildOptions
  if (options.identity !== undefined || hasDeveloperId()) return

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const entitlements = path.resolve(
    context.packager.info.projectDir,
    options.entitlements || 'build/entitlements.mac.plist'
  )
  console.log(`  • ad-hoc signing (no Developer ID certificate)  app=${app}`)
  // No hardened runtime: with an ad-hoc signature it breaks Electron's library validation.
  const args = ['--force', '--deep', '--sign', '-', '--entitlements', entitlements, app]
  execFileSync('codesign', args, { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
