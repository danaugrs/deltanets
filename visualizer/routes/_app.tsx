import { AppProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";

export default function App({ Component }: AppProps) {
  return (
    <>
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="global.css" />
        <link rel="icon" type="image/x-icon" href="favicon.ico"></link>
      </Head>
      <Component />
    </>
  );
}
