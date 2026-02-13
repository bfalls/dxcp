# @dxcp/backstage-plugin

Frontend governance card for DXCP.

## Purpose

Displays delivery governance information on Backstage Component pages.

## Reads Annotation

annotations: dxcp.io/service-id: demo-service

## Build

yarn workspace @dxcp/backstage-plugin build

Emits:

dist/index.js dist/index.d.ts

## Troubleshooting

If UI changes do not appear:

1.  Remove dist
2.  Rebuild
3.  Restart Backstage
