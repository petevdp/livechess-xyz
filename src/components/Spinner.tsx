import styles from './Spinner.module.css'

export function Spinner() {
	return (
		<div class={styles['lds-spinner']}>
        <div/>
        <div/>
        <div/>
        <div/>
        <div/>
        <div/>
        <div/>
        <div/>
        <div/>
        <div/>
        <div/>
        <div/>
		</div>
	)
}
