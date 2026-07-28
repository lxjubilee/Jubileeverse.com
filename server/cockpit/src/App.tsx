import * as React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Login         from './pages/Login'
import NotFound      from './pages/NotFound'
import { Editor }    from './pages/Editor'
import BackOfficeShell from './pages/BackOfficeShell'
import { ReviewBrowser } from './pages/ReviewBrowser'
import { TooltipProvider } from './components/ui/Tooltip'

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', color: '#dc2626' }}>
          <h2>Back Office Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {(this.state.error as Error).message}
            {'\n\n'}
            {(this.state.error as Error).stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 0,  // Always fetch fresh data
      gcTime: 0,     // Clear cache immediately
    },
  },
})
// Clear all cached queries on app load
queryClient.clear()

export default function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter basename="/backoffice">
          <Routes>
            <Route path="/"           element={<BackOfficeShell />} />
            <Route path="/content"    element={<BackOfficeShell />} />
            <Route path="/authors"    element={<BackOfficeShell />} />
            <Route path="/personas"   element={<BackOfficeShell />} />
            <Route path="/portal"     element={<BackOfficeShell />} />
            <Route path="/images"     element={<BackOfficeShell />} />
            <Route path="/websites"   element={<BackOfficeShell />} />
            <Route path="/prompts"    element={<BackOfficeShell />} />
            <Route path="/automation" element={<BackOfficeShell />} />
            <Route path="/audit"      element={<BackOfficeShell />} />
            <Route path="/users"      element={<BackOfficeShell />} />
            <Route path="/servers"    element={<BackOfficeShell />} />
            <Route path="/review/:id" element={<ReviewBrowser />} />
            <Route path="/editor/:id" element={<Editor />} />
            <Route path="/login"      element={<Login />} />
            <Route path="*"           element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  )
}
