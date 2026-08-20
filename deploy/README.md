# Deploying ParkCastSG to `prodesk`

The `Deploy to prodesk` workflow is a manual, branch-aware deployment. In
GitHub, open **Actions → Deploy to prodesk → Run workflow**, select the branch
or tag to test, and optionally provide a deployment name and host port.

Each deployment gets its own Compose project and directory under
`~/parkcastsg-deployments`. Leaving the port as `0` assigns a stable unused port
in the `18000-18999` range based on the deployment name. This allows `main` and
several feature branches to run at the same time. Re-running a deployment with
the same name updates that version in place.

## Required GitHub secrets

Add these repository secrets before running the workflow:

- `TAILSCALE_AUTHKEY`: a reusable, preferably ephemeral Tailscale auth key allowed to
  join the Tailnet.
- `PRODESK_SSH_PRIVATE_KEY`: the private key whose public key is in
  `~/.ssh/authorized_keys` for the deployment user on `prodesk`.

Optional secrets are `PRODESK_USER` (defaults to `junxu`), `PRODESK_HOST`
(defaults to `prodesk`), `PRODESK_DEPLOYMENT_ROOT` (defaults to
`parkcastsg-deployments`), `PRODESK_KNOWN_HOSTS`, `LTA_API_KEY`, and
`CORS_ALLOW_ORIGINS`. The verified `PRODESK_KNOWN_HOSTS` value can also be
stored as a repository variable rather than a secret. If omitted, the workflow
uses `ssh-keyscan` after joining the Tailnet and emits a warning; pinning the
verified host key is safer.

The target host must be a Linux Docker host with the Docker Compose plugin. The
workflow does not expose the service publicly; access it over the Tailnet at
the URL printed in the workflow log, for example `http://prodesk:18042`.

To remove one test version manually on the server:

```sh
cd ~/parkcastsg-deployments/<deployment-name>
docker compose -p parkcastsg-<deployment-name> down
```
