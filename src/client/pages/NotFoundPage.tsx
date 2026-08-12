import { Link } from "../router";
import { Card, CardContent } from "../components/ui/card";
import { buttonVariants } from "../components/ui/button";

export function NotFoundPage() {
  return (
    <Card className="my-3">
      <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
        <h1 className="text-2xl font-semibold">404</h1>
        <p className="text-sm text-muted-foreground">That page does not exist.</p>
        <Link to="/inbox" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to Inbox
        </Link>
      </CardContent>
    </Card>
  );
}
