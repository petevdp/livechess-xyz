import * as flip from 'flip-~/assets/icons/board.svg'
import * as notMuted from 'not-~/assets/icons/not-muted.svg'
import * as offerDraw from 'offer-~/assets/icons/draw.svg'
import { Component, ComponentProps } from 'solid-js'

import * as first from '~/assets/icons/first.svg'
import * as github from '~/assets/icons/github.svg'
import * as help from '~/assets/icons/help.svg'
import * as info from '~/assets/icons/info.svg'
import * as last from '~/assets/icons/last.svg'
import * as muted from '~/assets/icons/muted.svg'
import * as next from '~/assets/icons/next.svg'
import * as prev from '~/assets/icons/prev.svg'
import * as resign from '~/assets/icons/resign.svg'
import * as settings from '~/assets/icons/settings.svg'
import * as swap from '~/assets/icons/swap.svg'


// this is not good for treeshaking/codesplitting, if we get like 50+ icons we should just export manually
const _svgs = { first, flip, github, help, info, last, muted, next, notMuted, offerDraw, prev, resign, settings, swap }
export const Svgs = _svgs as unknown as Record<keyof typeof _svgs, Component<ComponentProps<'svg'>>>
