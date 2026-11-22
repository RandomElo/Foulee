/** La page en gris pendant la lecture des données : titre et cartes à leur place, pour que rien ne saute à l'arrivée. */
export function Squelette() {
  return (
    <div role="status" aria-label="Chargement" aria-busy="true">
      <div className="squelette h-8 w-40" />
      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="card squelette-carte h-36" />)}
      </div>
    </div>
  );
}
