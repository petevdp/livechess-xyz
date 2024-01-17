import { Component, ComponentProps } from 'solid-js'

import _first from '~/assets/icons/first.svg'
import _flip from '~/assets/icons/flip-board.svg'
import _github from '~/assets/icons/github.svg'
import _help from '~/assets/icons/help.svg'
import _info from '~/assets/icons/info.svg'
import _last from '~/assets/icons/last.svg'
import _logo from '~/assets/icons/logo.svg'
import _muted from '~/assets/icons/muted.svg'
import _next from '~/assets/icons/next.svg'
import _notMuted from '~/assets/icons/not-muted.svg'
import _offerDraw from '~/assets/icons/offer-draw.svg'
import _prev from '~/assets/icons/prev.svg'
import _resign from '~/assets/icons/resign.svg'
import _settings from '~/assets/icons/settings.svg'
import _swap from '~/assets/icons/swap.svg'


type SvgType = Component<ComponentProps<'svg'>>

function defaultSvg(Component: SvgType): SvgType {
	return (props) => <Component fill="hsl(var(--foreground))" {...props} />
}

export const FirstSvg = defaultSvg(_first as unknown as SvgType)
export const FlipSvg = defaultSvg(_flip as unknown as SvgType)
export const GithubSvg = defaultSvg(_github as unknown as SvgType)
export const HelpSvg = defaultSvg(_help as unknown as SvgType)
export const InfoSvg = defaultSvg(_info as unknown as SvgType)
export const LastSvg = defaultSvg(_last as unknown as SvgType)
export const MutedSvg = defaultSvg(_muted as unknown as SvgType)
export const NextSvg = defaultSvg(_next as unknown as SvgType)
export const NotMutedSvg = defaultSvg(_notMuted as unknown as SvgType)
export const OfferDrawSvg = defaultSvg(_offerDraw as unknown as SvgType)
export const PrevSvg = defaultSvg(_prev as unknown as SvgType)
export const ResignSvg = defaultSvg(_resign as unknown as SvgType)
export const SettingsSvg = defaultSvg(_settings as unknown as SvgType)
export const SwapSvg = defaultSvg(_swap as unknown as SvgType)
export const LogoSvg = defaultSvg(_logo as unknown as SvgType)
