package render

import "testing"

func TestExtractHeadings(t *testing.T) {
	body := "# Title\nintro\n## Section One\ntext\n### Sub Section\nmore text"
	headings := ExtractHeadings(body)
	if len(headings) != 3 {
		t.Fatalf("headings = %+v, want 3", headings)
	}
	if headings[0].Level != 1 || headings[0].Text != "Title" || headings[0].Slug != "title" {
		t.Fatalf("headings[0] = %+v", headings[0])
	}
	if headings[1].Level != 2 || headings[1].Slug != "section-one" {
		t.Fatalf("headings[1] = %+v", headings[1])
	}
	if headings[2].Level != 3 || headings[2].Slug != "sub-section" {
		t.Fatalf("headings[2] = %+v", headings[2])
	}
}

func TestExtractHeadings_NoHeadings(t *testing.T) {
	if got := ExtractHeadings("just some text"); len(got) != 0 {
		t.Fatalf("headings = %+v, want none", got)
	}
}
