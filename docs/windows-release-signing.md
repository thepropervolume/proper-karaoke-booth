# Windows release signing

Microsoft Defender SmartScreen checks downloaded app reputation. Current development EXEs and their installers are unsigned. Signing Windows releases gives them a verified publisher identity. New releases can still see initial SmartScreen warnings while reputation builds. A Microsoft Store MSIX distribution is separately re-signed by the Store and avoids the download prompt. [Microsoft SmartScreen guidance](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)

For the existing release website, the managed option is Azure Artifact Signing with a **Public Trust** certificate profile. Microsoft lists entry pricing at approximately US$9.99 per month. An organization or an eligible individual can use the service. The account owner completes identity validation in the Azure portal, with the legal publisher name used for signing. [Compare signing options](https://learn.microsoft.com/windows/apps/package-and-deploy/code-signing-options)

## Set up public signing

1. Choose the legal publisher identity and an Azure billing subscription. Start Public Trust validation in the Azure portal and complete its requested identity checks. For individual validation, the legal name and sold-to address on the billing account must match the government ID. [Artifact Signing setup](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
2. After validation, create a Public Trust certificate profile. Give the release workflow a dedicated federated identity with certificate profile signing access at the narrowest scope. Supply the service endpoint, account name, profile name and Azure identity configuration through GitHub release configuration. [GitHub Action for Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations#github-actions)
3. Sign and timestamp the app, native CLI launchers and uninstaller before they enter the installer or ZIP. Sign the final installer. Verify Authenticode signatures and timestamp chains on the assembled release artifacts before calculating published hashes.

The existing Windows installer uses its stable app ID, executable name, installation directory, shortcut name and uninstall key for upgrades. A signing rollout should preserve these identifiers. A change to signing must run the packaged CLI and Windows install/upgrade checks against the signed artifacts.
