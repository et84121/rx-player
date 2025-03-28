import * as React from "react";

/**
 * @param {Object} props
 * @returns {Object}
 */
function Option({
  title,
  children,
}: {
  title: string;
  children: React.JSX.Element;
}): React.JSX.Element {
  return (
    <div className="optionWrapper">
      <h4 className="optionTitle">{title}</h4>
      <hr className="spacer" />
      <ul className="loadVideooptions">{children}</ul>
    </div>
  );
}

export default React.memo(Option);
