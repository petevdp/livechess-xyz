import styles from './Spinner.module.css'

export function Spinner() {
	console.log({ styles })
	return (
		<div class={styles['lds-spinner']}>
			<div></div>
			<div></div>
			<div></div>
			<div></div>
			<div></div>
			<div></div>
			<div></div>
			<div></div>
			<div></div>
			<div></div>
			<div></div>
			<div></div>
		</div>
	)
}
