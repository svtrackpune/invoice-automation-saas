import styles from './editor.module.css';

export default function QuotationEditorLayout({children}:{children:React.ReactNode}){
  return <div className={styles.page}>{children}</div>;
}
