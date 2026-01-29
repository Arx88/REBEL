import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Plus, Loader2, Sparkles, Zap, FileText, Settings2 } from 'lucide-react';

interface CreateTaskDialogProps {
  onSubmit: (data: { userInput: string; context?: string; autoApprove: boolean }) => Promise<void>;
  loading?: boolean;
}

export function CreateTaskDialog({ onSubmit, loading = false }: CreateTaskDialogProps) {
  const [open, setOpen] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [context, setContext] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);

  const handleSubmit = async () => {
    if (!userInput.trim()) return;
    
    await onSubmit({
      userInput: userInput.trim(),
      context: context.trim() || undefined,
      autoApprove,
    });
    
    setUserInput('');
    setContext('');
    setAutoApprove(false);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-gradient-to-r from-primary to-cyan-500 hover:from-primary/90 hover:to-cyan-500/90 text-background font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all duration-300">
          <Plus className="w-4 h-4 mr-2" />
          New Task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[650px] p-0 overflow-hidden bg-card/95 backdrop-blur-xl border-border/50">
        <div className="p-6 pb-0">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-background" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold">Create New Task</DialogTitle>
                <DialogDescription className="text-sm">
                  Describe what you want the AI agents to accomplish
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>
        
        <div className="p-6 space-y-5">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <Label htmlFor="task-input" className="text-sm font-semibold">Task Description</Label>
            </div>
            <Textarea
              id="task-input"
              placeholder="e.g., Add JWT authentication to the API with login, register, and protected routes..."
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              className={cn(
                "min-h-[140px] resize-none text-sm",
                "bg-muted/30 border-border/50 focus:border-primary/50 focus:ring-primary/20",
                "placeholder:text-muted-foreground/50"
              )}
            />
            <p className="text-xs text-muted-foreground">
              Be as specific as possible for better results
            </p>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-muted-foreground" />
              <Label htmlFor="context-input" className="text-sm font-semibold text-muted-foreground">
                Additional Context
                <span className="ml-1 text-xs font-normal">(optional)</span>
              </Label>
            </div>
            <Textarea
              id="context-input"
              placeholder="Any relevant context, constraints, or preferences..."
              value={context}
              onChange={(e) => setContext(e.target.value)}
              className={cn(
                "min-h-[80px] resize-none text-sm",
                "bg-muted/30 border-border/50 focus:border-primary/50 focus:ring-primary/20",
                "placeholder:text-muted-foreground/50"
              )}
            />
          </div>
          
          <div className={cn(
            "flex items-center justify-between rounded-xl p-4",
            "border border-border/50 bg-muted/20",
            "hover:border-primary/30 hover:bg-primary/5 transition-all duration-300"
          )}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Zap className="w-4 h-4 text-amber-500" />
              </div>
              <div className="space-y-0.5">
                <Label htmlFor="auto-approve" className="text-sm font-semibold cursor-pointer">
                  Auto-approve plan
                </Label>
                <p className="text-xs text-muted-foreground">
                  Skip manual review and execute immediately
                </p>
              </div>
            </div>
            <Switch
              id="auto-approve"
              checked={autoApprove}
              onCheckedChange={setAutoApprove}
              className="data-[state=checked]:bg-primary"
            />
          </div>
        </div>
        
        <DialogFooter className="p-6 pt-0 gap-3">
          <Button 
            variant="ghost" 
            onClick={() => setOpen(false)}
            className="hover:bg-muted"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={!userInput.trim() || loading}
            className={cn(
              "min-w-[140px] bg-gradient-to-r from-primary to-cyan-500",
              "hover:from-primary/90 hover:to-cyan-500/90",
              "text-background font-semibold shadow-lg shadow-primary/20",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Create Task
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
