# Malware scanning

The GitHub Actions workflow builds and scans the website before deploying it to
GitHub Pages. A scan failure prevents the Pages deployment job from running.
The workflow also scans the Windows installer on version-tag pushes, or when
`scan_desktop` is selected in a manual workflow run.

## Enable gated GitHub Pages deployment

In the repository settings, open **Pages** and set **Build and deployment →
Source** to **GitHub Actions**. The workflow deploys pushes to `main` only
after the website build and scan succeed. Pull requests are scanned but are
not deployed. Protect `main` and require the **Scan website before deployment**
check if pull requests must pass scanning before merge.

To build and scan the Windows installer manually, open **Actions → Malware scan
and GitHub Pages → Run workflow**, select `main`, and enable **Build and scan
the Windows installer**. The installer artifact is retained for seven days
after the build; the scan job must succeed before distributing it.

## Scope and limitations

The workflow uses ClamAV malware signatures; it does not use or integrate with
McAfee Premium. A detection fails the workflow and blocks the workflow's
deployment, but does not remove or clean files from GitHub. Investigate and
remove/quarantine detected files in the source, then run the workflow again.

Signature scanners detect known threats and cannot guarantee that code is safe
or continuously protect a hosted website. McAfee installed on a Windows device
can separately protect that device while the user downloads or runs the app.
GitHub Pages is static hosting and does not run an antivirus process against
the live site.
