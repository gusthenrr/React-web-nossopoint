import React from "react";
export default class ErrorBoundary extends React.Component<{children: React.ReactNode},{error: any}> {
  state = { error: null };
  static getDerivedStateFromError(error: any) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:16, background:'#fee2e2', color:'#991b1b', fontFamily:'sans-serif'}}>
          <h3 style={{marginTop:0}}>Ocorreu um erro</h3>
          <pre style={{whiteSpace:'pre-wrap'}}>{String(this.state.error?.message || this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
