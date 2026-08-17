import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Erreur React inconnue.',
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Dashboard RH render error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            padding: '24px',
            background: '#f8fbff',
            color: '#0f172a',
            fontFamily: "'Candara', 'Segoe UI', sans-serif",
          }}
        >
          <section
            style={{
              width: 'min(720px, 100%)',
              padding: '24px',
              borderRadius: '24px',
              background: '#ffffff',
              border: '1px solid rgba(15, 23, 42, 0.08)',
              boxShadow: '0 18px 44px rgba(15, 23, 42, 0.08)',
            }}
          >
            <p style={{ margin: 0, color: '#2f6df6', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              Dashboard RH
            </p>
            <h1 style={{ margin: '10px 0 8px', fontFamily: "'Cambria', 'Georgia', serif" }}>
              Erreur d affichage
            </h1>
            <p style={{ margin: 0, color: '#64748b', lineHeight: 1.7 }}>
              L application a rencontre une erreur JavaScript. Recharge la page. Si le probleme continue,
              le message ci-dessous nous aidera a le corriger.
            </p>
            <pre
              style={{
                margin: '18px 0 0',
                padding: '16px',
                borderRadius: '16px',
                overflow: 'auto',
                background: '#0f172a',
                color: '#e2ecff',
                whiteSpace: 'pre-wrap',
              }}
            >
              {this.state.errorMessage}
            </pre>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);
