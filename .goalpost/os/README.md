# Goalpost Code OS pack

Stub manifest for clones of this template. `updates.enabled` defaults to true.

Super-admins publish versioned packs from this repository. Customer clones pull on session start when Settings "Receive Goalpost Code OS updates" is on.

This slice is the contract only. It does not include a live puller. Agents load the pack as always-on context the same way they load `AGENTS.md`. They do not dump `solvys-skills` into the factory.
