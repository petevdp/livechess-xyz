import { Component, ComponentProps } from 'solid-js'

import _first from '~/assets/icons/first.svg'
import _flip from '~/assets/icons/flip-board.svg'
import _github from '~/assets/icons/github.svg'
import _help from '~/assets/icons/help.svg'
import _info from '~/assets/icons/info.svg'
import _laptop from '~/assets/icons/laptop.svg'
import _last from '~/assets/icons/last.svg'
import _logo from '~/assets/icons/logo.svg'
import _moon from '~/assets/icons/moon.svg'
import _muted from '~/assets/icons/muted.svg'
import _next from '~/assets/icons/next.svg'
import _notMuted from '~/assets/icons/not-muted.svg'
import _offerDraw from '~/assets/icons/offer-draw.svg'
import _prev from '~/assets/icons/prev.svg'
import _resign from '~/assets/icons/resign.svg'
import _settings from '~/assets/icons/settings.svg'
import _sun from '~/assets/icons/sun.svg'
import _swap from '~/assets/icons/swap.svg'

type SvgType = Component<ComponentProps<'svg'>>

function defaultSvg(Component: SvgType): SvgType {
	return (props) => <Component fill="hsl(var(--foreground))" {...props} />
}

export const First = defaultSvg(_first as unknown as SvgType)
export const Flip = defaultSvg(_flip as unknown as SvgType)
export const Github = defaultSvg(_github as unknown as SvgType)
export const Help = defaultSvg(_help as unknown as SvgType)
export const Info = defaultSvg(_info as unknown as SvgType)
export const Last = defaultSvg(_last as unknown as SvgType)
export const Muted = defaultSvg(_muted as unknown as SvgType)
export const Next = defaultSvg(_next as unknown as SvgType)
export const NotMuted = defaultSvg(_notMuted as unknown as SvgType)
export const OfferDraw = defaultSvg(_offerDraw as unknown as SvgType)
export const Prev = defaultSvg(_prev as unknown as SvgType)
export const Resign = defaultSvg(_resign as unknown as SvgType)
export const Settings = defaultSvg(_settings as unknown as SvgType)
export const Swap = defaultSvg(_swap as unknown as SvgType)
export const Logo = defaultSvg(_logo as unknown as SvgType)

export const Sun = defaultSvg(_sun as unknown as SvgType)
export const Moon = defaultSvg(_moon as unknown as SvgType)
export const Laptop = defaultSvg(_laptop as unknown as SvgType)
