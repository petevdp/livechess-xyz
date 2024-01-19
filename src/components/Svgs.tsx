import { BiSolidChess } from 'solid-icons/bi'
import { FaSolidHandshake } from 'solid-icons/fa'
import { FiRefreshCw } from 'solid-icons/fi'
import {
	TbArrowsExchange,
	TbBrandGithub,
	TbDeviceLaptop,
	TbFlagFilled,
	TbHelpCircleFilled,
	TbInfoCircleFilled,
	TbPlayerSkipBackFilled,
	TbPlayerSkipForwardFilled,
	TbPlayerTrackNext,
	TbPlayerTrackNextFilled,
	TbPlayerTrackPrevFilled,
	TbSettingsFilled,
	TbSunFilled,
	TbSunOff,
	TbVolume,
	TbVolumeOff,
} from 'solid-icons/tb'

const defaultIcon: (component: typeof TbPlayerTrackNext) => typeof TbPlayerTrackNext = (Component) => {
	return (props) => <Component size={24} {...props} />
}

export const First = defaultIcon(TbPlayerSkipBackFilled)
export const Last = defaultIcon(TbPlayerSkipForwardFilled)
export const Flip = defaultIcon(FiRefreshCw)
export const Github = defaultIcon(TbBrandGithub)
export const Help = defaultIcon(TbHelpCircleFilled)
export const Info = defaultIcon(TbInfoCircleFilled)
export const Muted = defaultIcon(TbVolumeOff)
export const NotMuted = defaultIcon(TbVolume)
export const OfferDraw = defaultIcon(FaSolidHandshake)
export const Next = defaultIcon(TbPlayerTrackNextFilled)
export const Prev = defaultIcon(TbPlayerTrackPrevFilled)
export const Resign = defaultIcon(TbFlagFilled)
export const Settings = defaultIcon(TbSettingsFilled)
export const Swap = defaultIcon(TbArrowsExchange)
export const Logo = defaultIcon(BiSolidChess)
export const Laptop = defaultIcon(TbDeviceLaptop)
export const LightMode = defaultIcon(TbSunFilled)
export const DarkMode = defaultIcon(TbSunOff)
