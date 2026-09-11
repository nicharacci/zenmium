# Workspace graph

Company tenant
  DevOps team(s)     may debug, ship, and manage linked BizOps workspaces
    BizOps team(s)   client or internal ops. Cannot administer DevOps
      Client / product workspace

Hats (CAO DevOps vs BizOps) are how one agent switches in chat.
Teams are how this monorepo scales. v1 ships the records. Multi-team UI comes later.

`kind: devops | bizops`
`manages: []`  # workspace ids a DevOps team may open
