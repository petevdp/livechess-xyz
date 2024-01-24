#!/bin/sh

. ./.env
pnpx @highlight-run/sourcemap-uploader upload --apiKey ${HIGHLIGHT_API_KEY} --path ./dist

