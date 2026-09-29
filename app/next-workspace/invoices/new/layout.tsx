import styles from './editor.module.css';

export default function InvoiceEditorLayout({children}:{children:React.ReactNode}){
  return <div className={styles.page}>{children}</div>;
}
