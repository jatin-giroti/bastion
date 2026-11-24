import { Component } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "Unexpected rendering error." };
  }

  handleReset = () => {
    try {
      localStorage.removeItem("bastion_tour_seen");
    } catch {
      /* ignore */
    }
    this.setState({ hasError: false, message: "" });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-[#090D16] text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0F172A] p-6 text-center space-y-4 shadow-2xl">
          <div className="mx-auto w-10 h-10 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h1 className="text-sm font-semibold text-white">Workspace Recovery</h1>
            <p className="text-xs text-slate-400 leading-relaxed">{this.state.message}</p>
          </div>
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Workspace</span>
          </button>
        </div>
      </div>
    );
  }
}
