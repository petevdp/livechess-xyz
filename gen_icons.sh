#!/bin/sh

# generates all icons needed in app manifest

LOGO="./public/favicon.svg"

inkscape $LOGO -o public/icons/192.svg -w 192 -h 192
inkscape $LOGO -o public/icons/384.svg -w 384 -h 384
inkscape $LOGO -o public/icons/512.svg -w 512 -h 512
inkscape $LOGO -o public/icons/1024.svg -w 1024 -h 1024
